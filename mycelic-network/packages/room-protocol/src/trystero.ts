// SPDX-License-Identifier: GPL-2.0-or-later
// Lifecycle handler maps adapted from Chitchatter's PeerRoom wrapper; see THIRD_PARTY_NOTICES.md.
// Import this browser transport explicitly. The core SDK entry point does not initialize Trystero.
import {
  joinRoom,
  selfId,
  type Room,
  type MessageAction,
} from "trystero/nostr";
import type { RoomTransport, WireChannel, Unsubscribe } from "./ports";
export type TrysteroTransportOptions = {
  roomHash: string;
  routingSecret: string;
  appId?: string;
  rtcConfig?: RTCConfiguration;
  relayUrls?: string[];
};
export class TrysteroRoomTransport implements RoomTransport {
  readonly peerId = selfId;
  readonly support = {
    reliableOrdered: true,
    unreliableUnordered: false,
  };
  private room: Room;
  private joins = new Set<(id: string) => void>();
  private leaves = new Set<(id: string) => void>();
  private actions = new Map<
    string,
    {
      action: MessageAction<string>;
      limit: number;
      listeners: Set<(wire: string, peerId: string) => void>;
    }
  >();
  constructor(options: TrysteroTransportOptions) {
    this.room = joinRoom(
      {
        // Preserve the v1 discovery namespace so existing room links still find peers.
        appId: options.appId ?? "persistent-mesh-chat/v1",
        password: options.routingSecret,
        ...(options.rtcConfig ? { rtcConfig: options.rtcConfig } : {}),
        ...(options.relayUrls
          ? { relayConfig: { urls: options.relayUrls } }
          : {}),
      },
      options.roomHash,
    );
    this.room.onPeerJoin = (id) => {
      for (const handler of this.joins) handler(id);
    };
    this.room.onPeerLeave = (id) => {
      for (const handler of this.leaves) handler(id);
    };
  }
  peers = () => Object.keys(this.room.getPeers());
  onJoin = (handler: (id: string) => void): Unsubscribe => {
    this.joins.add(handler);
    return () => this.joins.delete(handler);
  };
  onLeave = (handler: (id: string) => void): Unsubscribe => {
    this.leaves.add(handler);
    return () => this.leaves.delete(handler);
  };
  channel = (name: string, maxBytes: number): WireChannel => {
    let entry = this.actions.get(name);
    if (entry && entry.limit !== maxBytes)
      throw new Error("Conflicting channel limits");
    if (!entry) {
      const listeners = new Set<(wire: string, peerId: string) => void>();
      const action = this.room.makeAction<string>(name, {
        onReceive: ({ byteLength }) => byteLength <= maxBytes,
      });
      action.onMessage = (wire, { peerId }) => {
        for (const listener of listeners) listener(wire, peerId);
      };
      entry = { action, limit: maxBytes, listeners };
      this.actions.set(name, entry);
    }
    const current = entry;
    return {
      send: async (wire, targets) => {
        if (targets.length)
          await current.action.send(wire, { target: [...targets] });
      },
      receive: (handler) => {
        current.listeners.add(handler);
        return () => current.listeners.delete(handler);
      },
    };
  };
  close = async () => {
    this.joins.clear();
    this.leaves.clear();
    for (const entry of this.actions.values()) entry.listeners.clear();
    this.actions.clear();
    await this.room.leave();
  };
}
