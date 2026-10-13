"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import type { PrivateKeyAccount } from "viem/accounts";
import { formatUnits } from "viem";
import type { ChatMesh } from "@/mesh/ChatMesh";
import { assertAccess } from "@/access/roomAccess";
import {
  canonical,
  type RoomDefinition,
  type SessionCertificate,
  type Invitation,
  type ChatRecord,
  type ChatMessage,
} from "@/types/protocol";
import { RoomApiError, type RoomClient } from "@/rooms/roomClient";
import type { PublicPaymentConfig } from "@/payments/shared";
import { messageDigest } from "@mycelic/room-protocol";
import { meshNetworkOptions } from "@/mesh/config";
import { Icon } from "./ui/Icon";
export type RoomMeshViewProps = {
  room: RoomDefinition;
  roomSecret: string;
  certificate: SessionCertificate;
  invitation?: Invitation;
  sessionAccount: PrivateKeyAccount;
  client: RoomClient;
  paymentConfig: PublicPaymentConfig;
  onExit: () => void;
};
export function RoomMeshView({
  room,
  roomSecret,
  certificate,
  invitation,
  sessionAccount,
  client,
  paymentConfig,
  onExit,
}: RoomMeshViewProps) {
  const { address } = useAccount();
  const [records, setRecords] = useState<ChatRecord[]>([]);
  const log = useRef<ChatRecord[]>([]);
  const mesh = useRef<ChatMesh | null>(null);
  const [peers, setPeers] = useState(0);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("Connecting");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const sendLock = useRef(false);
  const [retry, setRetry] = useState(false);
  const pending = useRef<{ message: ChatMessage; record?: ChatRecord } | null>(
    null,
  );
  const [balance, setBalance] = useState(0);
  const [buying, setBuying] = useState(false);
  const buyLock = useRef(false);
  const [pack, setPack] = useState<"10" | "100" | "500">("10");
  const [leaving, setLeaving] = useState(false);
  const exiting = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const lease = useRef(crypto.randomUUID());
  const walletMatches =
    address?.toLowerCase() === certificate.identity.toLowerCase();
  const append = useCallback((record: ChatRecord) => {
    if (log.current.some((r) => r.message.id === record.message.id)) return;
    log.current = [...log.current, record]
      .sort(
        (a, b) =>
          a.message.createdAt - b.message.createdAt ||
          a.message.id.localeCompare(b.message.id),
      )
      .slice(-5000);
    setRecords(log.current);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let instance: ChatMesh | null = null;
    const leaseId = crypto.randomUUID();
    lease.current = leaseId;
    let lastAdmission = Date.now();
    const heartbeat = async () => {
      await client.heartbeat(room.hash, leaseId);
      lastAdmission = Date.now();
      const value = await client.getPostingBalance(room.hash);
      if (!cancelled) setBalance(value);
    };
    void (async () => {
      try {
        const { ChatMesh } = await import("@/mesh/ChatMesh");
        if (cancelled) return;
        await heartbeat();
        if (cancelled) return;
        instance = new ChatMesh({
          room,
          maxParticipants: paymentConfig.maxParticipants,
          secret: roomSecret,
          account: sessionAccount,
          certificate,
          invitation,
          getHistory: () => log.current,
          onRecord: (record) => {
            if (!cancelled) append(record);
          },
          onPeers: (count) => {
            if (!cancelled) {
              setPeers(count);
              if (count === 0) {
                setReady(false);
                setStatus("Session closed");
              }
            }
          },
          onError: (message) => {
            if (!cancelled) setError(message);
          },
          ...meshNetworkOptions(),
        });
        mesh.current = instance;
        await instance.ready;
        if (cancelled) {
          await instance.leave();
          return;
        }
        setReady(true);
        setStatus("Mesh active");
        await heartbeat();
      } catch (e) {
        if (!cancelled) {
          await instance?.leave().catch(() => {});
          mesh.current = null;
          setReady(false);
          setError(e instanceof Error ? e.message : "Connection failed");
          setStatus("Connection failed");
        }
      }
    })();
    const interval = setInterval(() => {
      if (instance && !cancelled && !exiting.current)
        void heartbeat().catch((e) => {
          if (!cancelled) {
            setError(e.message);
            if (
              (e instanceof RoomApiError && [401, 403].includes(e.status)) ||
              e.code === "room_full" ||
              Date.now() - lastAdmission >= 45000
            ) {
              setReady(false);
              setStatus("Admission lost");
              void instance?.leave().catch(() => {});
            }
          }
        });
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      mesh.current = null;
      void instance?.leave().catch(() => {});
      void client.release(room.hash, leaseId).catch(() => {});
    };
  }, [
    room,
    roomSecret,
    certificate,
    invitation,
    sessionAccount,
    client,
    append,
    paymentConfig.maxParticipants,
  ]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (exiting.current || !log.current.length) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (leaving && !dialog.current?.open) dialog.current?.showModal();
    if (!leaving && dialog.current?.open) dialog.current.close();
  }, [leaving]);
  const send = async () => {
    if (
      sendLock.current ||
      !mesh.current ||
      !ready ||
      leaving ||
      !walletMatches ||
      (!text.trim() && !pending.current)
    )
      return;
    sendLock.current = true;
    setSending(true);
    setError("");
    try {
      await assertAccess(room, certificate.identity, invitation);
      if (certificate.expiresAt <= Date.now())
        throw new Error(
          "Session expired. Renew your session access before posting.",
        );
      if (!pending.current) {
        const body = {
          id: crypto.randomUUID(),
          roomHash: room.hash,
          sender: certificate.identity,
          session: sessionAccount.address,
          text: text.trim(),
          createdAt: Date.now(),
        };
        pending.current = {
          message: {
            ...body,
            signature: await sessionAccount.signMessage({
              message: canonical(body),
            }),
          },
        };
      }
      if (!pending.current.record) {
        const { message } = pending.current;
        const paid = await client.payMessageFee(
          room.hash,
          message.id,
          messageDigest(message),
        );
        setBalance(paid.balance);
        pending.current.record = {
          message,
          certificate,
          ...(invitation ? { invitation } : {}),
          receipt: paid.receipt,
        };
      }
      await mesh.current.send(pending.current.record);
      pending.current = null;
      setRetry(false);
      setText("");
      setNotice(
        peers <= 1
          ? "Paid post is in this node’s memory. No other participants are connected yet."
          : "Paid post sent to connected participants.",
      );
    } catch (e) {
      setRetry(!!pending.current);
      setError(e instanceof Error ? e.message : "Post failed");
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  };
  const buy = async () => {
    if (buyLock.current || !walletMatches) return;
    buyLock.current = true;
    setBuying(true);
    setError("");
    try {
      setBalance(await client.buyPostingCredits(room.hash, pack));
      setNotice(
        "Posting credits added. Each accepted post deducts 0.012 USDC.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      buyLock.current = false;
      setBuying(false);
    }
  };
  const recover = async () => {
    if (buyLock.current || !walletMatches) return;
    buyLock.current = true;
    setBuying(true);
    setError("");
    try {
      const statuses = await client.checkPendingPayments();
      setBalance(await client.getPostingBalance(room.hash));
      setNotice(
        statuses.length
          ? statuses
              .map(
                (s) =>
                  `${s.kind}: ${s.status}${s.error ? ` (${s.error})` : ""}`,
              )
              .join(" · ")
          : "No pending payments in this tab.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment check failed");
    } finally {
      buyLock.current = false;
      setBuying(false);
    }
  };
  const leave = async () => {
    exiting.current = true;
    try {
      await mesh.current?.leave();
      await client.release(room.hash, lease.current);
    } catch {
      /* Lease expires after a missed heartbeat. */
    }
    log.current = [];
    pending.current = null;
    setRecords([]);
    onExit();
  };
  return (
    <section className="room">
      <header className="room-header">
        <div>
          <div className="eyebrow">
            <span className="dot" />
            {status.toUpperCase()}
          </div>
          <h1>{room.title}</h1>
          <div className="room-badges">
            <span className="pill">
              {room.policy.mode === "direct" ? "1-to-1" : "Group"}
            </span>
            <span className="pill">{peers} connected participants</span>
            <span className="pill">
              Up to{" "}
              {room.policy.mode === "direct"
                ? 2
                : paymentConfig.maxParticipants}{" "}
              participants
            </span>
            <span className="pill">Ephemeral · no archives</span>
            <span className="pill">
              {paymentConfig.policy.environment === "mainnet"
                ? "Test USDC"
                : "USDC"}
            </span>
          </div>
        </div>
        <button
          className="secondary"
          disabled={sending || buying}
          onClick={() => setLeaving(true)}
        >
          Leave room ↗
        </button>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!walletMatches && (
        <p className="error" role="alert">
          Reconnect the wallet that authorized this session, or renew session
          access with your current wallet, before posting.
        </p>
      )}
      <div className="room-grid">
        <div className="conversation">
          <div
            className="messages"
            aria-label="Chat messages"
            aria-live="polite"
          >
            {!records.length && (
              <div className="empty">
                <span>
                  <Icon name="nodes" width={48} height={48} />
                </span>
                <h2>Your room is alive.</h2>
                <p>
                  Share the private link to bring someone in.
                  <br />
                  Messages exist only in connected participants’ memory.
                </p>
              </div>
            )}
            {records.map(({ message }) => (
              <article
                className={`message ${message.session === sessionAccount.address ? "mine" : ""}`}
                key={message.id}
              >
                <div className="message-meta">
                  <b>
                    {message.sender.slice(0, 8)}…{message.sender.slice(-4)}
                  </b>
                  <time>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <span className="paid-label">Paid</span>
                </div>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="sr-only" htmlFor="message">
              Message
            </label>
            <textarea
              id="message"
              maxLength={4000}
              placeholder="Write to the room…"
              value={text}
              disabled={retry || sending || leaving}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-bottom">
              <small>0.012 USDC per post · Enter to send</small>
              <button
                className="primary"
                disabled={
                  !ready ||
                  sending ||
                  buying ||
                  leaving ||
                  !walletMatches ||
                  (!text.trim() && !retry)
                }
                type="submit"
              >
                {sending
                  ? "Sending…"
                  : retry
                    ? "Retry same message"
                    : "Send · 0.012 USDC →"}
              </button>
            </div>
          </form>
        </div>
        <aside className="room-sidebar">
          <div className="card">
            <h3>Posting credits</h3>
            <p className="credit-balance" data-testid="posting-balance">
              {formatUnits(BigInt(balance), 6)} USDC
            </p>
            <p>{Math.floor(balance / 12000)} posts available</p>
            <label>
              Posting pack
              <select
                value={pack}
                disabled={buying}
                onChange={(e) => setPack(e.target.value as typeof pack)}
              >
                <option value="10">10 posts · 0.12 USDC</option>
                <option value="100">100 posts · 1.20 USDC</option>
                <option value="500">500 posts · 6.00 USDC</option>
              </select>
            </label>
            <button
              className="primary full"
              disabled={buying || sending || !walletMatches}
              onClick={() => void buy()}
            >
              {buying ? "Check your wallet…" : "Buy posting credits"}
            </button>
            <button
              className="quiet full"
              disabled={buying || sending || !walletMatches}
              onClick={() => void recover()}
            >
              Check pending payments
            </button>
            <p className="fine">
              One wallet signature per pack. Credits belong to your wallet
              across rooms. A paid post is charged once even when retried;
              delivery is best effort.
            </p>
          </div>
          <div className="card">
            <h3>Invite a peer</h3>
            <p>The link contains the room key. Share it privately.</p>
            <button
              className="quiet full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setNotice("Room link copied.");
                } catch {
                  setError("Copy the link from your address bar.");
                }
              }}
            >
              Copy room link
            </button>
            <p className="fine">
              Joining and reading are free. Each participant funds their own
              posting credits.
            </p>
          </div>
          <p className="fine">
            No recording or savepoints. Remaining peers can keep their in-memory
            history after you leave. Participants can still copy messages.
          </p>
        </aside>
      </div>
      <dialog
        ref={dialog}
        className="save-dialog"
        onCancel={(e) => {
          e.preventDefault();
          setLeaving(false);
        }}
      >
        <span className="eyebrow">EPHEMERAL CHAT</span>
        <h2>Leave this room?</h2>
        <p>
          Your local message history will be cleared. Other connected
          participants may still have it. Your unused posting credits stay with
          your wallet.
        </p>
        <div className="row">
          <button className="quiet" onClick={() => setLeaving(false)}>
            Stay connected
          </button>
          <button className="primary" onClick={() => void leave()}>
            Leave and clear local history
          </button>
        </div>
      </dialog>
    </section>
  );
}
