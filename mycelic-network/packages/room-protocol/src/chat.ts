import { verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  canonical,
  unsigned,
  recordSchema,
  type ChatRecord,
  type RoomDefinition,
} from "./types";
import { validateSessionCertificate } from "./session";
import { messageDigest, verifyPaymentReceipt } from "./payments";
import { MODULE_IDS } from "./manifest";
import type {
  AdmissionVerifier,
  RoomModule,
  ModuleContext,
  ModuleChannel,
  Unsubscribe,
} from "./ports";
export const verifyChatRecord = async (
  input: unknown,
  room: RoomDefinition,
  authorize: AdmissionVerifier,
  live = true,
): Promise<ChatRecord> => {
  const record = recordSchema.parse(input);
  const { message, certificate } = record;
  if (
    message.roomHash !== room.hash ||
    message.sender.toLowerCase() !== certificate.identity.toLowerCase() ||
    message.session.toLowerCase() !== certificate.session.toLowerCase()
  )
    throw new Error("Message identity mismatch");
  if (message.createdAt > Date.now() + 30_000)
    throw new Error("Message timestamp is in the future");
  await validateSessionCertificate(
    certificate,
    room.hash,
    live ? Date.now() : message.createdAt,
  );
  if (message.createdAt >= certificate.expiresAt)
    throw new Error("Message was signed after certificate expiry");
  if (
    !(await verifyMessage({
      address: message.session as Address,
      message: canonical(unsigned(message)),
      signature: message.signature as Hex,
    }))
  )
    throw new Error("Invalid message signature");
  if (live) await authorize(room, message.sender, record.invitation);
  else if (
    room.policy.allowlist.length &&
    !room.policy.allowlist.some(
      (a) => a.toLowerCase() === message.sender.toLowerCase(),
    )
  )
    throw new Error("History sender is not allowlisted");
  if (room.payment)
    await verifyPaymentReceipt(record.receipt, room.payment, {
      purpose: "post",
      roomHash: room.hash,
      sender: message.sender,
      session: message.session,
      messageId: message.id,
      digest: messageDigest(message),
    });
  return record;
};
export type ChatModuleOptions = {
  room: RoomDefinition;
  authorize: AdmissionVerifier;
  getHistory: () => readonly ChatRecord[];
  onRecord: (record: ChatRecord) => void;
};
/** Signed chat. Paid v3 requires service receipts for live messages and backfill. */
export class ChatModule implements RoomModule {
  readonly definition = {
    id: MODULE_IDS.chat,
    version: 2,
    channels: [
      { name: "message", maxBytes: 64_000 },
      { name: "history", maxBytes: 300_000 },
    ],
  };
  private message: ModuleChannel<ChatRecord> | null = null;
  private seen = new Set<string>();
  private closed = false;
  private unsubscribes: Unsubscribe[] = [];
  constructor(private options: ChatModuleOptions) {
    this.definition.version = options.room.payment ? 3 : 2;
  }
  setup(context: ModuleContext) {
    this.message = context.channel("message", (value) =>
      recordSchema.parse(value),
    );
    const schema = z.union([
      z.object({ request: z.literal(true) }),
      z.object({ records: z.array(recordSchema).max(100) }),
    ]);
    const history = context.channel("history", (value) => schema.parse(value));
    this.unsubscribes.push(
      this.message.onMessage(async (record, { peer }) => {
        const valid = await verifyChatRecord(
          record,
          this.options.room,
          this.options.authorize,
        );
        if (
          valid.certificate.session.toLowerCase() !==
          peer.certificate.session.toLowerCase()
        )
          throw new Error(
            "Peer is forwarding a live message under another session",
          );
        this.accept(valid);
      }),
    );
    this.unsubscribes.push(
      context.onPeerJoined(async (peer) => {
        await history.send({ request: true }, [peer.peerId]);
      }),
    );
    this.unsubscribes.push(
      history.onMessage(async (data, { peer }) => {
        if ("request" in data) {
          const records = this.options.getHistory().slice(-500);
          for (let offset = 0; offset < records.length; offset += 10)
            await history.send(
              { records: records.slice(offset, offset + 10) },
              [peer.peerId],
            );
        } else
          for (const record of data.records)
            this.accept(
              await verifyChatRecord(
                record,
                this.options.room,
                this.options.authorize,
                false,
              ),
            );
      }),
    );
  }
  private accept(record: ChatRecord) {
    if (this.closed || this.seen.has(record.message.id)) return;
    this.seen.add(record.message.id);
    this.options.onRecord(record);
  }
  async send(record: ChatRecord) {
    if (this.closed || !this.message)
      throw new Error("Chat module is disconnected");
    await verifyChatRecord(record, this.options.room, this.options.authorize);
    await this.message.send(record);
    this.accept(record);
  }
  dispose() {
    this.closed = true;
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.message = null;
    this.seen.clear();
  }
}
