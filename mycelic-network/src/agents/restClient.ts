import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, type Hex } from "viem";
import { LocalRoomClient } from "@/rooms/roomClient";
import { signRoom, issueInvitation, verifyRoom } from "@/access/roomAccess";
import {
  generateRoomSecret,
  chatProtocol,
  canonical,
  assertPaymentPolicy,
  verifyPaymentReceipt,
  roomDigest,
  messageDigest,
  policySchema,
  type RoomDefinition,
  type Invitation,
  type ChatRecord,
} from "@mycelic/room-protocol";
import {
  publicPaymentConfigSchema,
  type PublicPaymentConfig,
} from "@/payments/shared";
import { signGatewayChallenge, type PaymentSigner } from "@/payments/client";
/** REST payment and signing client. Supply a browser/native RoomTransport to deliver records. */
export class MycelicAgentClient {
  readonly wallet;
  readonly sessionKey = generatePrivateKey();
  readonly session = privateKeyToAccount(this.sessionKey);
  readonly rooms: LocalRoomClient;
  config!: PublicPaymentConfig;
  joined: {
    room: RoomDefinition;
    secret: string;
    certificate: Awaited<ReturnType<MycelicAgentClient["certificate"]>>;
    invitation?: Invitation;
  } | null = null;
  private spent = 0n;
  constructor(
    readonly origin: string,
    key: Hex,
    readonly chain = "arcTestnet",
    readonly maximumSpend = 4200000n,
  ) {
    this.wallet = privateKeyToAccount(key);
    this.rooms = new LocalRoomClient(
      this.session,
      new URL("/api/rooms", origin).toString(),
    );
    this.rooms.setPaymentSigner(async (challenge, amount) => {
      if (this.spent + BigInt(amount) > maximumSpend)
        throw new Error("Agent spending limit exceeded");
      const signer: PaymentSigner = {
        address: this.wallet.address,
        signTypedData: (p) => this.wallet.signTypedData(p),
      };
      const signature = await signGatewayChallenge(
        challenge,
        this.config,
        signer,
        this.chain,
        amount,
      );
      // Count authorizations even if the HTTP response is lost. Retry reuses the same authorization.
      this.spent += BigInt(amount);
      return signature;
    });
  }
  async initialize() {
    const response = await fetch(new URL("/api/payments/config", this.origin));
    if (!response.ok) throw new Error("Payment configuration unavailable");
    this.config = publicPaymentConfigSchema.parse(await response.json());
    return this.config;
  }
  async certificate(room: RoomDefinition) {
    const body = {
      roomHash: room.hash,
      identity: this.wallet.address,
      session: this.session.address,
      expiresAt: Date.now() + 3600000,
    };
    return {
      ...body,
      signature: await this.wallet.signMessage({ message: canonical(body) }),
    };
  }
  private async admit(
    room: RoomDefinition,
    secret: string,
    invitation?: Invitation,
  ) {
    const certificate = await this.certificate(room);
    this.rooms.setAdmission(certificate, invitation);
    return { room, secret, certificate, ...(invitation ? { invitation } : {}) };
  }
  private creationDraft: Awaited<
    ReturnType<MycelicAgentClient["admit"]>
  > | null = null;
  async create(
    title: string,
    policy: unknown = { mode: "group", allowlist: [], inviteRequired: false },
  ) {
    if (!this.config) await this.initialize();
    if (this.joined) return this.joined;
    if (!this.creationDraft) {
      const room = await signRoom(
        {
          hash: keccak256(`0x${generateRoomSecret()}`),
          title,
          owner: this.wallet.address,
          createdAt: Date.now(),
          policy: policySchema.parse(policy),
          protocol: chatProtocol(true),
          payment: this.config.policy,
        },
        this.wallet,
      );
      const invitation = room.policy.inviteRequired
        ? await issueInvitation(
            room,
            this.wallet.address,
            Date.now() + 3600000,
            this.wallet,
          )
        : undefined;
      this.creationDraft = await this.admit(
        room,
        generateRoomSecret(),
        invitation,
      );
    }
    await this.rooms.createRoom(this.creationDraft.room);
    this.joined = this.creationDraft;
    this.creationDraft = null;
    return this.joined;
  }
  async join(link: string) {
    if (!this.config) await this.initialize();
    const url = new URL(link);
    if (url.origin !== new URL(this.origin).origin)
      throw new Error("Invite belongs to another service");
    const params = new URLSearchParams(url.hash.slice(1));
    const secret = params.get("key");
    if (!secret || !/^[0-9a-f]{64}$/.test(secret))
      throw new Error("Invalid room key");
    const metadata = await this.rooms.getRoomMetadata(params.get("room") || "");
    const room = await verifyRoom(metadata.room);
    assertPaymentPolicy(room, this.config.policy);
    const r = metadata.creationReceipt;
    await verifyPaymentReceipt(r, this.config.policy, {
      purpose: "create",
      roomHash: room.hash,
      sender: room.owner,
      session: room.owner,
      messageId: r?.messageId || "",
      digest: roomDigest(room),
    });
    this.joined = await this.admit(
      room,
      secret,
      params.has("invite") ? JSON.parse(params.get("invite")!) : undefined,
    );
    return this.joined;
  }
  async buyCredits(pack: "10" | "100" | "500" = "10") {
    if (!this.joined) throw new Error("Join first");
    return this.rooms.buyPostingCredits(this.joined.room.hash, pack);
  }
  async checkPendingPayments() {
    return this.rooms.checkPendingPayments();
  }
  async balance() {
    if (!this.joined) throw new Error("Join first");
    return this.rooms.getPostingBalance(this.joined.room.hash);
  }
  private postDrafts = new Map<string, ChatRecord["message"]>();
  async preparePost(
    text: string,
    id = crypto.randomUUID(),
  ): Promise<ChatRecord> {
    if (!this.joined) throw new Error("Join first");
    if (!text.trim() || text.length > 4000)
      throw new Error("Message must contain 1-4000 characters");
    const { room, certificate, invitation } = this.joined;
    const body = {
      id,
      roomHash: room.hash,
      sender: certificate.identity,
      session: this.session.address,
      text: text.trim(),
      createdAt: Date.now(),
    };
    let message = this.postDrafts.get(id);
    if (message && message.text !== text.trim())
      throw new Error("Post retry cannot change content");
    if (!message) {
      message = {
        ...body,
        signature: await this.session.signMessage({ message: canonical(body) }),
      };
      this.postDrafts.set(id, message);
    }
    const { receipt } = await this.rooms.payMessageFee(
      room.hash,
      id,
      messageDigest(message),
    );
    return {
      message,
      certificate,
      ...(invitation ? { invitation } : {}),
      receipt,
    };
  }
  link() {
    if (!this.joined) throw new Error("Join first");
    return `${this.origin}/chat#${new URLSearchParams({ room: this.joined.room.hash, key: this.joined.secret, ...(this.joined.invitation ? { invite: JSON.stringify(this.joined.invitation) } : {}) })}`;
  }
}
