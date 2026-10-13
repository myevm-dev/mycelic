import type {
  RoomDefinition,
  SessionCertificate,
  Invitation,
  Capability,
} from "./types";
export type Unsubscribe = () => void;
export type WireChannel = {
  send: (data: string, targets: readonly string[]) => Promise<void>;
  receive: (handler: (data: string, peerId: string) => void) => Unsubscribe;
};
/** A transport carries bytes; it never decides membership, pricing or game rules. */
export interface RoomTransport {
  readonly peerId: string;
  readonly support: {
    reliableOrdered: boolean;
    unreliableUnordered: boolean;
  };
  peers(): string[];
  onJoin(handler: (peerId: string) => void): Unsubscribe;
  onLeave(handler: (peerId: string) => void): Unsubscribe;
  channel(name: string, maxBytes: number): WireChannel;
  close(): Promise<void>;
}
export type AuthenticatedPeer = {
  peerId: string;
  certificate: SessionCertificate;
  invitation?: Invitation;
  capabilities: Capability[];
};
export type MessageContext = { peer: AuthenticatedPeer };
export type ModuleChannel<T> = {
  send: (payload: T, targets?: readonly string[]) => Promise<void>;
  onMessage: (
    handler: (payload: T, context: MessageContext) => void | Promise<void>,
  ) => Unsubscribe;
};
export type ChannelDefinition = {
  name: string;
  maxBytes: number;
  /** Reserved for legacy chat interoperability. Other modules use hashed namespaces. */ legacyWireName?: string;
};
export type ModuleDefinition = {
  id: string;
  version: number;
  channels: readonly ChannelDefinition[];
};
export type ModuleContext = {
  room: Readonly<RoomDefinition>;
  localCertificate: Readonly<SessionCertificate>;
  peers: () => AuthenticatedPeer[];
  channel: <T>(name: string, parse: (input: unknown) => T) => ModuleChannel<T>;
  onPeerJoined: (
    handler: (peer: AuthenticatedPeer) => void | Promise<void>,
  ) => Unsubscribe;
  onPeerLeft: (
    handler: (peerId: string) => void | Promise<void>,
  ) => Unsubscribe;
};
/** Trusted code installed by the host application. Never load arbitrary code from a room manifest. */
export interface RoomModule {
  readonly definition: ModuleDefinition;
  setup(context: ModuleContext): void | Promise<void>;
  dispose(): void | Promise<void>;
}
export type AdmissionVerifier = (
  room: RoomDefinition,
  identity: string,
  invitation?: Invitation,
) => Promise<void>;
