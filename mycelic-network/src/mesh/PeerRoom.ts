// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted from Jeremy Kahn's Chitchatter src/lib/PeerRoom/PeerRoom.ts.
// Source revision 23b62a8d95be003e490e5a050335e1dea4b79cc7.
// Changes: Nostr strategy, typed message actions, reduced to text lifecycle hooks.
import {
  joinRoom,
  type Room,
  type MessageAction,
  type DataPayload,
} from "trystero/nostr";
export type RoomConfig = Parameters<typeof joinRoom>[0];
export class PeerRoom {
  readonly room: Room;
  private joins = new Map<string, (peerId: string) => void>();
  private leaves = new Map<string, (peerId: string) => void>();
  constructor(config: RoomConfig, roomId: string) {
    this.room = joinRoom(config, roomId);
    this.room.onPeerJoin = (peerId) => {
      for (const handler of this.joins.values()) handler(peerId);
    };
    this.room.onPeerLeave = (peerId) => {
      for (const handler of this.leaves.values()) handler(peerId);
    };
  }
  onPeerJoin = (namespace: string, handler: (peerId: string) => void) => {
    this.joins.set(namespace, handler);
  };
  onPeerLeave = (namespace: string, handler: (peerId: string) => void) => {
    this.leaves.set(namespace, handler);
  };
  getPeers = (): string[] => Object.keys(this.room.getPeers());
  makeAction = <T extends DataPayload>(
    name: string,
    maxBytes = 64_000,
  ): MessageAction<T> =>
    this.room.makeAction<T>(name, {
      onReceive: ({ byteLength }) => byteLength <= maxBytes,
    });
  leaveRoom = async (): Promise<void> => {
    this.joins.clear();
    this.leaves.clear();
    await this.room.leave();
  };
}
