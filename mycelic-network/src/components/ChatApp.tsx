"use client";
import { useEffect, useState, useRef } from "react";
import {
  useAccount,
  useSignMessage,
  useWalletClient,
  useSwitchChain,
} from "wagmi";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Address, keccak256 } from "viem";
import {
  signRoom,
  verifyRoom,
  assertAccess,
  needsWallet,
  issueInvitation,
} from "@/access/roomAccess";
import {
  canonical,
  policySchema,
  invitationSchema,
  type RoomDefinition,
  type Invitation,
  type SessionCertificate,
} from "@/types/protocol";
import { LocalRoomClient } from "@/rooms/roomClient";
import { PaymentPanel } from "./PaymentPanel";
import { signGatewayChallenge, type PaymentSigner } from "@/payments/client";
import {
  publicPaymentConfigSchema,
  type PublicPaymentConfig,
} from "@/payments/shared";
import {
  assertPaymentPolicy,
  verifyPaymentReceipt,
  roomDigest,
} from "@mycelic/room-protocol";
import { generateRoomSecret } from "@/utils/savepointEngine";
import { RoomMeshView } from "./RoomMeshView";
import { chatProtocol } from "@mycelic/room-protocol";
import { APP_CHAINS } from "@/chains/config";
import { Icon } from "./ui/Icon";
type JoinedRoom = {
  room: RoomDefinition;
  secret: string;
  certificate: SessionCertificate;
  invitation?: Invitation;
};
export function ChatApp() {
  const [session] = useState(() => privateKeyToAccount(generatePrivateKey()));
  const [client] = useState(() => new LocalRoomClient(session));
  const [paymentConfig, setPaymentConfig] =
    useState<PublicPaymentConfig | null>(null);
  const [chainKey, setChainKey] = useState("arcTestnet");
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const [joined, setJoined] = useState<JoinedRoom | null>(null);
  const [title, setTitle] = useState("The gathering");
  const [mode, setMode] = useState<"group" | "direct">("group");
  const [allowlist, setAllowlist] = useState("");
  const [inviteRequired, setInviteRequired] = useState(false);
  const [nftContract, setNftContract] = useState("");
  const [nftChain, setNftChain] = useState<number>(8453);
  const [nftStandard, setNftStandard] = useState<"erc721" | "erc1155">(
    "erc721",
  );
  const [tokenId, setTokenId] = useState("");
  const [joinLink, setJoinLink] = useState("");
  const [invitedWallet, setInvitedWallet] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const creationDraft = useRef<{
    room: RoomDefinition;
    secret: string;
    invitation?: Invitation;
  } | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/payments/config")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        return publicPaymentConfigSchema.parse(data);
      })
      .then((config) => {
        if (!cancelled) {
          setPaymentConfig(config);
          setChainKey(config.preferredChain);
          try {
            const saved = sessionStorage.getItem("mycelic.creation-draft");
            if (saved) {
              const draft = JSON.parse(saved);
              if (draft.room?.payment?.serviceId === config.policy.serviceId) {
                creationDraft.current = draft;
                setHasDraft(true);
              }
            }
          } catch {
            /* Local draft recovery is best effort. */
          }
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const sync = () =>
      setJoinLink(window.location.hash ? window.location.href : "");
    window.addEventListener("hashchange", sync);
    const timer = setTimeout(sync, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  useEffect(() => {
    client.setPaymentSigner(async (challenge, amount) => {
      if (!walletClient || !address || !paymentConfig)
        throw new Error("Connect an EOA wallet before paying");
      const chain = paymentConfig.networks.find((n) => n.key === chainKey);
      if (!chain) throw new Error("Unsupported payment network");
      await switchChainAsync({ chainId: chain.chainId });
      const signer: PaymentSigner = {
        address,
        signTypedData: (params) =>
          walletClient.signTypedData({ ...params, account: address }),
      };
      return signGatewayChallenge(
        challenge,
        paymentConfig,
        signer,
        chainKey,
        amount,
      );
    });
  }, [
    client,
    address,
    walletClient,
    paymentConfig,
    chainKey,
    switchChainAsync,
  ]);
  const walletSigner = () => {
    if (!address) throw new Error("Connect a wallet first");
    return {
      address,
      signMessage: ({ message }: { message: string }) =>
        signMessageAsync({ message }),
    };
  };
  const prepareAdmission = async (
    room: RoomDefinition,
    secret: string,
    invitation?: Invitation,
  ) => {
    let identity: Address = session.address;
    if (room.payment || needsWallet(room.policy)) {
      if (!address) throw new Error("Connect an allowed wallet first");
      identity = address;
    }
    await assertAccess(room, identity, invitation);
    const body = {
      roomHash: room.hash,
      identity,
      session: session.address,
      expiresAt: Date.now() + 60 * 60 * 1000,
    };
    const signature =
      identity === session.address
        ? await session.signMessage({ message: canonical(body) })
        : await signMessageAsync({ message: canonical(body) });
    const certificate = { ...body, signature };
    client.setAdmission(certificate, invitation);
    return { room, secret, certificate, invitation };
  };
  const authorize = async (
    room: RoomDefinition,
    secret: string,
    invitation?: Invitation,
  ) => {
    const joinedRoom = await prepareAdmission(room, secret, invitation);
    setJoined(joinedRoom);
    window.history.replaceState(
      null,
      "",
      `/chat#${new URLSearchParams({ room: room.hash, key: secret, ...(invitation ? { invite: JSON.stringify(invitation) } : {}) })}`,
    );
  };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      if (creationDraft.current) {
        const { room, secret, invitation } = creationDraft.current;
        if (room.owner.toLowerCase() !== address?.toLowerCase())
          throw new Error(
            "Reconnect the room creator wallet to retry this creation",
          );
        const admitted = await prepareAdmission(room, secret, invitation);
        await client.createRoom(room);
        setJoined(admitted);
        creationDraft.current = null;
        setHasDraft(false);
        sessionStorage.removeItem("mycelic.creation-draft");
        window.history.replaceState(
          null,
          "",
          `/chat#${new URLSearchParams({ room: room.hash, key: secret, ...(invitation ? { invite: JSON.stringify(invitation) } : {}) })}`,
        );
        return;
      }
      const wallets = allowlist.split(/[\s,;]+/).filter(Boolean);
      if (
        mode === "direct" &&
        address &&
        !wallets.some((a) => a.toLowerCase() === address.toLowerCase())
      )
        wallets.unshift(address);
      const policy = policySchema.parse({
        mode,
        allowlist: wallets,
        inviteRequired,
        ...(nftContract
          ? {
              nft: {
                contract: nftContract,
                chainId: nftChain,
                standard: nftStandard,
                ...(tokenId ? { tokenId } : {}),
              },
            }
          : {}),
      });
      if (!paymentConfig?.enabled)
        throw new Error(
          paymentConfig?.reason || "Payment service is not ready",
        );
      if (!address)
        throw new Error("Connect your wallet to create and enter a gated room");
      // A creator is not exempt from the room's wallet/NFT gates.
      const room = await signRoom(
        {
          hash: keccak256(`0x${generateRoomSecret()}`),
          title,
          owner: address!,
          createdAt: Date.now(),
          policy,
          protocol: chatProtocol(true),
          payment: paymentConfig.policy,
        },
        walletSigner(),
      );
      const invitation = policy.inviteRequired
        ? await issueInvitation(
            room,
            address!,
            Date.now() + 24 * 60 * 60 * 1000,
            walletSigner(),
          )
        : undefined;
      await assertAccess(room, address ?? session.address, invitation);
      const secret = generateRoomSecret();
      const admitted = await prepareAdmission(room, secret, invitation);
      creationDraft.current = { room, secret, invitation };
      setHasDraft(true);
      sessionStorage.setItem(
        "mycelic.creation-draft",
        JSON.stringify(creationDraft.current),
      );
      await client.createRoom(room);
      setJoined(admitted);
      creationDraft.current = null;
      setHasDraft(false);
      sessionStorage.removeItem("mycelic.creation-draft");
      window.history.replaceState(
        null,
        "",
        `/chat#${new URLSearchParams({ room: room.hash, key: secret, ...(invitation ? { invite: JSON.stringify(invitation) } : {}) })}`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Room creation failed");
    } finally {
      setBusy(false);
    }
  };
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const link = new URL(joinLink, window.location.origin);
      const params = new URLSearchParams(link.hash.slice(1));
      const hash = params.get("room");
      const secret = params.get("key");
      if (!hash || !secret || !/^[0-9a-f]{64}$/.test(secret))
        throw new Error("Paste a complete room invite link with a room key");
      const metadata = await client.getRoomMetadata(hash);
      const room = await verifyRoom(metadata.room);
      if (!paymentConfig) throw new Error("Payment configuration is not ready");
      assertPaymentPolicy(room, paymentConfig.policy);
      const creation = metadata.creationReceipt;
      await verifyPaymentReceipt(creation, paymentConfig.policy, {
        purpose: "create",
        roomHash: room.hash,
        sender: room.owner,
        session: room.owner,
        messageId: creation?.messageId || "",
        digest: roomDigest(room),
      });
      const rawInvite = params.get("invite");
      const invitation = rawInvite
        ? invitationSchema.parse(JSON.parse(rawInvite))
        : undefined;
      await authorize(room, secret, invitation);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to join room");
    } finally {
      setBusy(false);
    }
  };
  const invite = async () => {
    if (!joined) return;
    setError("");
    try {
      const invitation = await issueInvitation(
        joined.room,
        invitedWallet as Address,
        Date.now() + 24 * 60 * 60 * 1000,
        walletSigner(),
      );
      invitationSchema.parse(invitation);
      const params = new URLSearchParams({
        room: joined.room.hash,
        key: joined.secret,
        invite: JSON.stringify(invitation),
      });
      setInviteLink(`${window.location.origin}/chat#${params}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invitation failed");
    }
  };
  return (
    <main className="shell chat-page" id="main-content" tabIndex={-1}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {joined ? (
        <>
          <RoomMeshView
            room={joined.room}
            roomSecret={joined.secret}
            certificate={joined.certificate}
            invitation={joined.invitation}
            sessionAccount={session}
            client={client}
            paymentConfig={paymentConfig!}
            onExit={() => {
              setJoined(null);
              setInviteLink("");
              window.history.replaceState(null, "", "/chat");
            }}
          />
          <button
            className="quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await authorize(joined.room, joined.secret, joined.invitation);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : "Unable to renew session access",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Renew wallet/session access
          </button>
          {joined.room.owner.toLowerCase() === address?.toLowerCase() && (
            <details className="owner-panel">
              <summary>Owner invitation controls</summary>
              <p>
                Issue a wallet-bound invitation, valid for 24 hours. All
                configured access gates still apply.
              </p>
              <div className="row">
                <input
                  aria-label="Invited wallet address"
                  placeholder="0x… wallet address"
                  value={invitedWallet}
                  onChange={(e) => setInvitedWallet(e.target.value)}
                />
                <button onClick={() => void invite()}>Create invitation</button>
              </div>
              {inviteLink && (
                <label>
                  Invitation link
                  <textarea
                    readOnly
                    value={inviteLink}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
            </details>
          )}
        </>
      ) : (
        <>
          <header className="app-hero">
            <div className="section-topline">
              <span className="icon-tile">
                <Icon name="chat" />
              </span>
              <span className="eyebrow">MYCELIC CHAT</span>
              <span className="pill">Arc testnet payments</span>
            </div>
            <h1>
              Mycelic Chat<span className="accent-text">.</span>
            </h1>
            <p className="page-lede">
              Private conversations. Pay only to create and post.
            </p>
            <p>
              Ephemeral WebRTC rooms. $3.00 to create, $0.012 per message.
              Reading and joining are free.
            </p>
          </header>
          {paymentConfig && (
            <PaymentPanel
              config={paymentConfig}
              chainKey={chainKey}
              onChainChange={setChainKey}
            />
          )}
          <div className="home-grid">
            <section className="card">
              <div className="card-title">
                <span className="step">01</span>
                <div>
                  <h2>Start a room</h2>
                  <p>Create a room and share its private link.</p>
                </div>
              </div>
              <label>
                Room name
                <input
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <div className="segmented">
                <button
                  aria-pressed={mode === "group"}
                  onClick={() => setMode("group")}
                >
                  Group room
                </button>
                <button
                  aria-pressed={mode === "direct"}
                  onClick={() => setMode("direct")}
                >
                  1-to-1 room
                </button>
              </div>
              <details open={mode === "direct"}>
                <summary>Access and invitation controls</summary>
                <label>
                  {mode === "direct"
                    ? "Other wallet (your connected wallet is added)"
                    : "Allowed wallets, optional"}
                  <textarea
                    placeholder="0x… one address per line"
                    value={allowlist}
                    onChange={(e) => setAllowlist(e.target.value)}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={inviteRequired}
                    onChange={(e) => setInviteRequired(e.target.checked)}
                  />
                  Require an owner-signed invitation
                </label>
                <label>
                  NFT contract, optional
                  <input
                    placeholder="0x…"
                    value={nftContract}
                    onChange={(e) => setNftContract(e.target.value)}
                  />
                </label>
                <div className="row">
                  <label>
                    Network
                    <select
                      value={nftChain}
                      onChange={(e) => setNftChain(Number(e.target.value))}
                    >
                      {APP_CHAINS.map((chain) => (
                        <option key={chain.id} value={chain.id}>
                          {chain.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    NFT type
                    <select
                      value={nftStandard}
                      onChange={(e) =>
                        setNftStandard(e.target.value as "erc721" | "erc1155")
                      }
                    >
                      <option value="erc721">ERC-721</option>
                      <option value="erc1155">ERC-1155</option>
                    </select>
                  </label>
                </div>
                <label>
                  Token ID
                  <input
                    placeholder={
                      nftStandard === "erc721"
                        ? "Optional, any NFT if blank"
                        : "Required"
                    }
                    value={tokenId}
                    onChange={(e) => setTokenId(e.target.value)}
                  />
                </label>
              </details>
              <button
                className="primary full"
                disabled={busy || !address || !paymentConfig?.enabled}
                onClick={() => void create()}
              >
                {busy
                  ? "Check your wallet…"
                  : hasDraft
                    ? "Retry same room creation"
                    : "Create room · 3 USDC"}
              </button>
              <p className="fine">
                Connect your wallet, fund Gateway, then confirm the creation
                payment. No message history is stored on the server.
              </p>
            </section>
            <section className="card">
              <div className="card-title">
                <span className="step">02</span>
                <div>
                  <h2>Join the conversation</h2>
                  <p>Bring your room link and encryption key.</p>
                </div>
              </div>
              <label>
                Room invitation link
                <textarea
                  className="join-input"
                  placeholder="Paste the complete room link"
                  value={joinLink}
                  onChange={(e) => setJoinLink(e.target.value)}
                />
              </label>
              <button
                className="secondary full"
                disabled={busy || !joinLink}
                onClick={() => void join()}
              >
                Join room →
              </button>
              <div className="how">
                <div>
                  <b>01 / Direct mesh</b>
                  <p>WebRTC data channels. Nostr signaling.</p>
                </div>
                <div>
                  <b>02 / One session</b>
                  <p>Signed messages from authenticated participants.</p>
                </div>
                <div>
                  <b>03 / Ephemeral history</b>
                  <p>
                    Messages remain in connected participants’ memory. No
                    savepoints.
                  </p>
                </div>
              </div>
            </section>
          </div>
          <footer>
            Payment receipts and room metadata use a persistent ledger. Chat
            text and room keys are never sent to that ledger. Mycelic Games and
            Voice are coming soon.
          </footer>
        </>
      )}
    </main>
  );
}
