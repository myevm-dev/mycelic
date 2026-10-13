import type {
  RoomDefinition,
  SessionCertificate,
  Invitation,
  ChatRecord,
} from "@/types/protocol";
import type { Hex } from "viem";
export type AgentBridge = {
  join: (args: {
    room: RoomDefinition;
    secret: string;
    sessionKey: Hex;
    certificate: SessionCertificate;
    invitation?: Invitation;
  }) => Promise<void>;
  send: (record: ChatRecord) => Promise<void>;
  read: () => ChatRecord[];
  status: () => { connected: boolean; participants: number; errors: string[] };
  leave: () => Promise<void>;
};
declare global {
  interface Window {
    mycelicAgent?: AgentBridge;
  }
}
