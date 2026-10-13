"use client";
import { useEffect, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";
import { ChatMesh } from "@/mesh/ChatMesh";
import { publicPaymentConfigSchema } from "@/payments/shared";
import { LocalRoomClient, RoomApiError } from "@/rooms/roomClient";
import {
  assertPaymentPolicy,
  canonical,
  verifyPaymentReceipt,
  roomDigest,
} from "@mycelic/room-protocol";
import type { ChatRecord } from "@/types/protocol";
import { meshNetworkOptions } from "@/mesh/config";
import type { AgentBridge } from "@/agents/bridgeTypes";
export function AgentBridgeView() {
  const [state, setState] = useState("Waiting for an agent");
  useEffect(() => {
    let mesh: ChatMesh | null = null;
    let records: ChatRecord[] = [];
    let participants = 0;
    let connected = false;
    let client: LocalRoomClient | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let lease = "";
    let hash = "";
    let lastAdmission = Date.now();
    const errors: string[] = [];
    const bridge: AgentBridge = {
      join: async (args) => {
        if (mesh)
          throw new Error("Leave the current room before joining another");
        const response = await fetch("/api/payments/config");
        if (!response.ok) throw new Error("Payment configuration unavailable");
        const config = publicPaymentConfigSchema.parse(await response.json());
        assertPaymentPolicy(args.room, config.policy);
        const account = privateKeyToAccount(args.sessionKey);
        client = new LocalRoomClient(account);
        client.setAdmission(args.certificate, args.invitation);
        const metadata = await client.getRoomMetadata(args.room.hash);
        if (canonical(metadata.room) !== canonical(args.room))
          throw new Error("Registered room definition mismatch");
        const r = metadata.creationReceipt;
        await verifyPaymentReceipt(r, config.policy, {
          purpose: "create",
          roomHash: args.room.hash,
          sender: args.room.owner,
          session: args.room.owner,
          messageId: r?.messageId || "",
          digest: roomDigest(args.room),
        });
        const append = (record: ChatRecord) => {
          if (!records.some((r) => r.message.id === record.message.id))
            records = [...records, record].slice(-5000);
        };
        hash = args.room.hash;
        lease = crypto.randomUUID();
        await client.heartbeat(hash, lease);
        lastAdmission = Date.now();
        mesh = new ChatMesh({
          room: args.room,
          maxParticipants: config.maxParticipants,
          secret: args.secret,
          account,
          certificate: args.certificate,
          invitation: args.invitation,
          getHistory: () => records,
          onRecord: append,
          onPeers: (n) => {
            participants = n;
            if (n === 0) connected = false;
          },
          onError: (e) => {
            errors.push(e);
            if (errors.length > 50) errors.shift();
          },
          ...meshNetworkOptions(),
        });
        try {
          await mesh.ready;
        } catch (e) {
          await mesh.leave().catch(() => {});
          mesh = null;
          await client.release(hash, lease).catch(() => {});
          throw e;
        }
        connected = true;
        timer = setInterval(
          () =>
            void client
              ?.heartbeat(hash, lease)
              .then(() => {
                lastAdmission = Date.now();
              })
              .catch((e) => {
                errors.push(e.message);
                if (errors.length > 50) errors.shift();
                if (
                  (e instanceof RoomApiError &&
                    ([401, 403].includes(e.status) ||
                      e.code === "room_full")) ||
                  Date.now() - lastAdmission >= 45000
                ) {
                  connected = false;
                  void mesh?.leave().catch(() => {});
                }
              }),
          15000,
        );
        setState("Agent connected");
      },
      send: async (record) => {
        if (!mesh || !connected) throw new Error("Agent is not connected");
        await mesh.send(record);
      },
      read: () => structuredClone(records),
      status: () => ({ connected, participants, errors: [...errors] }),
      leave: async () => {
        if (timer) clearInterval(timer);
        await mesh?.leave();
        await client?.release(hash, lease).catch(() => {});
        mesh = null;
        records = [];
        connected = false;
        participants = 0;
        setState("Agent disconnected");
      },
    };
    window.mycelicAgent = bridge;
    return () => {
      delete window.mycelicAgent;
      void bridge.leave();
    };
  }, []);
  return (
    <main className="shell product-page" id="main-content" tabIndex={-1}>
      <section className="card">
        <span className="eyebrow">MYCELIC AGENT BRIDGE</span>
        <h1>{state}</h1>
        <p>
          This page supplies browser WebRTC to the local agent client. Wallet
          keys stay in the agent process. Only a temporary room session key
          enters this page.
        </p>
        <p>
          Messages stay in memory while connected. Closing this page disconnects
          the agent.
        </p>
      </section>
    </main>
  );
}
