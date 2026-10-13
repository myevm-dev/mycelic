// Compatibility facade: the existing UI now consumes the reusable authenticated session core.
import {
  RoomSession,
  type SessionCertificate,
  type Invitation,
  type RoomDefinition,
  type ChatRecord,
} from "@mycelic/room-protocol";
import { ChatModule, verifyChatRecord } from "@mycelic/room-protocol/chat";
import { TrysteroRoomTransport } from "@mycelic/room-protocol/trystero";
import { type PrivateKeyAccount } from "viem/accounts";
import { assertAccess } from "@/access/roomAccess";
export const verifyRecord = (
  input: unknown,
  room: RoomDefinition,
  live = true,
): Promise<ChatRecord> => verifyChatRecord(input, room, assertAccess, live);
export type MeshOptions = {
  room: RoomDefinition;
  secret: string;
  account: PrivateKeyAccount;
  certificate: SessionCertificate;
  invitation?: Invitation;
  getHistory: () => readonly ChatRecord[];
  onRecord: (record: ChatRecord) => void;
  onPeers: (count: number) => void;
  onError: (message: string) => void;
  rtcConfig?: RTCConfiguration;
  relayUrls?: string[];
  maxParticipants?: number;
};
export class ChatMesh {
  readonly ready: Promise<void>;
  readonly session: RoomSession;
  private chat: ChatModule;
  constructor(options: MeshOptions) {
    this.chat = new ChatModule({
      room: options.room,
      authorize: assertAccess,
      getHistory: options.getHistory,
      onRecord: options.onRecord,
    });
    this.session = new RoomSession({
      room: options.room,
      account: options.account,
      certificate: options.certificate,
      invitation: options.invitation,
      maxPeers:
        Math.min(
          options.maxParticipants ?? 8,
          options.room.policy.mode === "direct" ? 2 : 8,
        ) - 1,
      createTransport: () =>
        new TrysteroRoomTransport({
          roomHash: options.room.hash,
          routingSecret: options.secret,
          rtcConfig: options.rtcConfig,
          relayUrls: options.relayUrls,
        }),
      authorize: assertAccess,
      onPeers: (peers) =>
        options.onPeers(
          this.session.status === "closed" ? 0 : peers.length + 1,
        ),
      onError: (error) => options.onError(error.message),
    });
    this.session.install(this.chat);
    this.ready = this.session.start();
  }
  async send(record: ChatRecord) {
    await this.ready;
    await this.chat.send(record);
  }
  leave() {
    return this.session.close();
  }
}
