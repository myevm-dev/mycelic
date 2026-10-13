import { hashMessage, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  canonical,
  unsigned,
  roomSchema,
  certificateSchema,
  capabilitySchema,
  moduleIdSchema,
  invitationSchema,
  type RoomDefinition,
  type SessionCertificate,
  type Invitation,
  type Capability,
} from "./types";
import {
  resolveRoomProtocol,
  assertCapabilities,
  MODULE_IDS,
} from "./manifest";
import type {
  RoomTransport,
  RoomModule,
  ModuleContext,
  ModuleChannel,
  AuthenticatedPeer,
  AdmissionVerifier,
  Unsubscribe,
  MessageContext,
} from "./ports";

export type SessionSigner = {
  address: Address;
  signMessage: (input: { message: string }) => Promise<Hex>;
};
export type RoomSessionOptions = {
  room: RoomDefinition;
  account: SessionSigner;
  certificate: SessionCertificate;
  invitation?: Invitation;
  maxPeers?: number;
  createTransport: () => RoomTransport | Promise<RoomTransport>;
  authorize: AdmissionVerifier;
  onPeers?: (peers: AuthenticatedPeer[]) => void;
  onError?: (error: Error) => void;
};
type MessageHandler = (
  value: unknown,
  context: MessageContext,
) => void | Promise<void>;
type ChannelState = {
  wireName: string;
  maxBytes: number;
  parse: (input: unknown) => unknown;
  handlers: Set<MessageHandler>;
  moduleId: string;
};
const challengeSchema = z.object({
  nonce: z.string().uuid(),
  requester: z.string().max(100),
  expiresAt: z.number().int(),
});
const authSchema = z.object({
  certificate: certificateSchema,
  invitation: invitationSchema.optional(),
  nonce: z.string().uuid(),
  proof: z.string(),
  capabilities: z.array(capabilitySchema).max(32).optional(),
});
const readySchema = z.object({ ready: z.literal(true) }).strict();
export const validateSessionCertificate = async (
  input: unknown,
  roomHash: string,
  at = Date.now(),
): Promise<SessionCertificate> => {
  const cert = certificateSchema.parse(input);
  if (
    cert.roomHash !== roomHash ||
    cert.expiresAt <= at ||
    cert.expiresAt > at + 86_400_000
  )
    throw new Error("Expired or invalid session");
  if (
    !(await verifyMessage({
      address: cert.identity as Address,
      message: canonical(unsigned(cert)),
      signature: cert.signature as Hex,
    }))
  )
    throw new Error("Invalid identity signature");
  return cert;
};

/** Headless member-session kernel. Owns authentication and lifecycle, never game rules or billing.
 * Modules are application-trusted code, not a sandbox for arbitrary uploaded JavaScript. */
export class RoomSession {
  private state: "idle" | "starting" | "active" | "closing" | "closed" = "idle";
  private modules = new Map<string, RoomModule>();
  private initialized: RoomModule[] = [];
  private transport: RoomTransport | null = null;
  private accepted = new Map<string, AuthenticatedPeer>();
  private challenges = new Map<string, { nonce: string; expiresAt: number }>();
  private queues = new Map<string, Promise<void>>();
  private queueCounts = new Map<string, number>();
  private pending = new Map<
    string,
    { channel: ChannelState; wire: string }[]
  >();
  private channels = new Map<string, ChannelState>();
  private joined = new Set<(peer: AuthenticatedPeer) => void | Promise<void>>();
  private departed = new Set<(peerId: string) => void | Promise<void>>();
  private unsubscribes: Unsubscribe[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readyPeers = new Set<string>();
  private pendingReady = new Set<string>();
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  constructor(private readonly options: RoomSessionOptions) {
    if (
      options.maxPeers !== undefined &&
      (!Number.isInteger(options.maxPeers) ||
        options.maxPeers < 1 ||
        options.maxPeers > 127)
    )
      throw new Error("Invalid peer capacity");
  }
  install(plugin: RoomModule): this {
    if (this.state !== "idle")
      throw new Error("Install modules before starting the session");
    const { definition } = plugin;
    moduleIdSchema.parse(definition.id);
    if (this.modules.has(definition.id))
      throw new Error(`Duplicate plugin: ${definition.id}`);
    const declared = resolveRoomProtocol(this.options.room).modules.find(
      (m) => m.id === definition.id && m.version === definition.version,
    );
    if (!declared)
      throw new Error(
        `Module is not declared in the signed room: ${definition.id}`,
      );
    if (!Number.isSafeInteger(definition.version) || definition.version < 1)
      throw new Error("Invalid plugin version");
    if (
      definition.channels.length > 32 ||
      new Set(definition.channels.map((c) => c.name)).size !==
        definition.channels.length
    )
      throw new Error("Invalid plugin channels");
    for (const channel of definition.channels) {
      if (
        !/^[a-z][a-z0-9-]{0,31}$/.test(channel.name) ||
        channel.maxBytes < 1 ||
        channel.maxBytes > 1_000_000 ||
        !Number.isSafeInteger(channel.maxBytes)
      )
        throw new Error("Invalid channel limits");
      if (
        channel.legacyWireName &&
        (definition.id !== MODULE_IDS.chat ||
          definition.version !== 1 ||
          !["v1.message", "v1.history"].includes(channel.legacyWireName))
      )
        throw new Error("Legacy wire aliases are reserved for v1 chat");
    }
    this.modules.set(definition.id, plugin);
    return this;
  }
  peers = (): AuthenticatedPeer[] =>
    [...this.accepted.values()]
      .filter((p) => p.certificate.expiresAt > Date.now())
      .map((p) => structuredClone(p));
  get status() {
    return this.state;
  }
  start = (): Promise<void> => {
    if (this.state === "closed" || this.state === "closing")
      return Promise.reject(new Error("Session is closed"));
    if (this.startPromise) return this.startPromise;
    if (this.state !== "idle")
      return Promise.reject(new Error("Session is closed"));
    this.state = "starting";
    this.startPromise = this.startInternal();
    return this.startPromise;
  };
  private alive = () => this.state === "starting" || this.state === "active";
  private report(error: unknown) {
    try {
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    } catch {
      /* Diagnostics never become authentication or cleanup decisions. */
    }
  }
  private notify() {
    try {
      this.options.onPeers?.(this.peers());
    } catch (error) {
      this.report(error);
    }
  }
  private guard(peerId: string, task: () => Promise<void>) {
    if (!this.alive() || !this.transport?.peers().includes(peerId)) return;
    if ((this.queueCounts.get(peerId) ?? 0) >= 32) {
      this.report(new Error("Peer input queue limit reached"));
      return;
    }
    this.queueCounts.set(peerId, (this.queueCounts.get(peerId) ?? 0) + 1);
    const previous = this.queues.get(peerId) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        if (this.alive()) await task();
      })
      .catch((error) => this.report(error))
      .finally(() => {
        this.queueCounts.set(
          peerId,
          Math.max(0, (this.queueCounts.get(peerId) ?? 1) - 1),
        );
        if (this.queues.get(peerId) === next) this.queues.delete(peerId);
      });
    this.queues.set(peerId, next);
  }
  private supports(peer: AuthenticatedPeer, moduleId: string): boolean {
    const version = this.modules.get(moduleId)?.definition.version;
    return peer.capabilities.some(
      (c) => c.id === moduleId && c.version === version,
    );
  }
  private async startInternal() {
    try {
      const room = roomSchema.parse(this.options.room);
      if (
        !(await verifyMessage({
          address: room.owner as Address,
          message: canonical(unsigned(room)),
          signature: room.signature as Hex,
        }))
      )
        throw new Error("Invalid room policy signature");
      assertCapabilities(
        resolveRoomProtocol(room),
        [...this.modules.values()].map((m) => m.definition),
      );
      const cert = await validateSessionCertificate(
        this.options.certificate,
        room.hash,
      );
      if (
        cert.session.toLowerCase() !==
        this.options.account.address.toLowerCase()
      )
        throw new Error("Local session signer mismatch");
      await this.options.authorize(
        room,
        cert.identity,
        this.options.invitation,
      );
      if (!this.alive()) throw new Error("Session was closed while starting");
      const transport = await this.options.createTransport();
      if (!this.alive()) {
        await transport.close();
        throw new Error("Session was closed while starting");
      }
      this.transport = transport;
      if (!transport.support.reliableOrdered)
        throw new Error("V1 requires reliable ordered control messages");
      for (const plugin of this.modules.values()) {
        this.initialized.push(plugin);
        await plugin.setup(this.context(plugin));
        if (!this.alive())
          throw new Error("Session was closed while initializing modules");
      }
      this.attachAuthentication();
      this.state = "active";
      this.notify();
      this.timer = setInterval(() => {
        if (this.options.certificate.expiresAt <= Date.now()) {
          this.report(
            new Error(
              "Session certificate expired; renew access before reconnecting",
            ),
          );
          void this.close().catch((error) => this.report(error));
          return;
        }
        for (const [id, peer] of this.accepted)
          if (peer.certificate.expiresAt <= Date.now()) this.dropPeer(id);
        for (const [id, pending] of this.challenges)
          if (pending.expiresAt < Date.now()) {
            this.challenges.delete(id);
            this.pending.delete(id);
            this.pendingReady.delete(id);
          }
      }, 10_000);
      for (const peerId of transport.peers()) this.challengePeer(peerId);
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  private localCapabilities(): Capability[] {
    return [...this.modules.values()].map((m) => ({
      id: m.definition.id,
      version: m.definition.version,
      required: resolveRoomProtocol(this.options.room).modules.find(
        (c) => c.id === m.definition.id,
      )!.required,
    }));
  }
  private challengePeer = (peerId: string) => {
    if (!this.alive() || !this.transport || this.challenges.size >= 128) return;
    const request = {
      nonce: crypto.randomUUID(),
      requester: this.transport.peerId,
      expiresAt: Date.now() + 30_000,
    };
    this.challenges.set(peerId, request);
    void this.transport
      .channel("v1.challenge", 64_000)
      .send(JSON.stringify(request), [peerId])
      .catch((error) => this.report(error));
  };
  private attachAuthentication() {
    const transport = this.transport!;
    const challenge = transport.channel("v1.challenge", 64_000);
    const auth = transport.channel("v1.auth", 64_000);
    const ready = transport.channel("v1.ready", 1024);
    this.unsubscribes.push(
      transport.onJoin(this.challengePeer),
      transport.onLeave((id) => this.dropPeer(id)),
    );
    this.unsubscribes.push(
      challenge.receive((wire, peerId) =>
        this.guard(peerId, async () => {
          const request = challengeSchema.parse(JSON.parse(wire));
          if (
            request.requester !== peerId ||
            request.expiresAt < Date.now() ||
            request.expiresAt > Date.now() + 35_000
          )
            throw new Error("Invalid peer challenge");
          // Preserve legacy proofs for rooms without a manifest. Manifest-aware capability claims are signed.
          const capabilities = this.options.room.protocol
            ? this.localCapabilities()
            : undefined;
          const proof = await this.options.account.signMessage({
            message: canonical({
              roomHash: this.options.room.hash,
              nonce: request.nonce,
              peerId: transport.peerId,
              requester: peerId,
              ...(capabilities ? { capabilities } : {}),
            }),
          });
          if (this.alive())
            await auth.send(
              JSON.stringify({
                certificate: this.options.certificate,
                invitation: this.options.invitation,
                nonce: request.nonce,
                proof,
                ...(capabilities ? { capabilities } : {}),
              }),
              [peerId],
            );
        }),
      ),
    );
    this.unsubscribes.push(
      auth.receive((wire, peerId) =>
        this.guard(peerId, async () => {
          const data = authSchema.parse(JSON.parse(wire));
          const pending = this.challenges.get(peerId);
          if (
            !pending ||
            pending.nonce !== data.nonce ||
            pending.expiresAt < Date.now()
          )
            throw new Error("Peer proof is stale");
          const certificate = await validateSessionCertificate(
            data.certificate,
            this.options.room.hash,
          );
          if (
            !(await verifyMessage({
              address: certificate.session as Address,
              signature: data.proof as Hex,
              message: canonical({
                roomHash: this.options.room.hash,
                nonce: data.nonce,
                peerId,
                requester: transport.peerId,
                ...(data.capabilities
                  ? { capabilities: data.capabilities }
                  : {}),
              }),
            }))
          )
            throw new Error("Peer failed proof of session key");
          const capabilities = data.capabilities ?? [
            { id: MODULE_IDS.chat, version: 1, required: true },
          ];
          if (
            new Set(capabilities.map((c) => c.id)).size !== capabilities.length
          )
            throw new Error("Duplicate peer capabilities");
          assertCapabilities(
            resolveRoomProtocol(this.options.room),
            capabilities,
          );
          await this.options.authorize(
            this.options.room,
            certificate.identity,
            data.invitation,
          );
          if (!this.alive() || !transport.peers().includes(peerId)) return;
          this.challenges.delete(peerId);
          const peer = {
            peerId,
            certificate,
            invitation: data.invitation,
            capabilities,
          };
          if (
            !this.accepted.has(peerId) &&
            this.accepted.size >= (this.options.maxPeers ?? 127)
          )
            throw new Error("Room peer capacity reached");
          this.accepted.set(peerId, peer);
          this.notify();
          await ready.send(JSON.stringify({ ready: true }), [peerId]);
          for (const handler of this.joined)
            await handler(structuredClone(peer));
          if (this.pendingReady.delete(peerId)) await this.markReady(peerId);
          const buffered = this.pending.get(peerId) ?? [];
          this.pending.delete(peerId);
          for (const { channel, wire } of buffered)
            await this.dispatch(channel, wire, peerId);
        }),
      ),
    );
    this.unsubscribes.push(
      ready.receive((wire, peerId) =>
        this.guard(peerId, async () => {
          readySchema.parse(JSON.parse(wire));
          if (!this.accepted.has(peerId)) {
            if (this.challenges.has(peerId)) this.pendingReady.add(peerId);
            return;
          }
          await this.markReady(peerId);
        }),
      ),
    );
  }
  private context(plugin: RoomModule): ModuleContext {
    const { id } = plugin.definition;
    const modulePeers = () =>
      this.peers().filter((peer) => this.supports(peer, id));
    const onPeerJoined: ModuleContext["onPeerJoined"] = (handler) => {
      const wrapped = (peer: AuthenticatedPeer) =>
        this.supports(peer, id) ? handler(peer) : undefined;
      this.joined.add(wrapped);
      return () => this.joined.delete(wrapped);
    };
    const context: ModuleContext = {
      room: structuredClone(this.options.room),
      localCertificate: structuredClone(this.options.certificate),
      peers: modulePeers,
      channel: <T>(
        name: string,
        parse: (input: unknown) => T,
      ): ModuleChannel<T> => {
        const declaration = plugin.definition.channels.find(
          (c) => c.name === name,
        );
        if (!declaration) throw new Error("Module channel was not declared");
        const wireName =
          declaration.legacyWireName ??
          `m.${hashMessage(`${id}@${plugin.definition.version}:${name}`).slice(2, 18)}`;
        if (this.channels.has(wireName))
          throw new Error("Channel namespace collision");
        const channel: ChannelState = {
          wireName,
          maxBytes: declaration.maxBytes,
          parse,
          handlers: new Set(),
          moduleId: id,
        };
        this.channels.set(wireName, channel);
        const wireChannel = this.transport!.channel(wireName, channel.maxBytes);
        this.unsubscribes.push(
          wireChannel.receive((wire, peerId) =>
            this.guard(peerId, async () => {
              if (!this.accepted.has(peerId)) {
                const queue = this.pending.get(peerId) ?? [];
                if (
                  this.challenges.has(peerId) &&
                  queue.length < 8 &&
                  new TextEncoder().encode(wire).length +
                    queue.reduce((n, item) => n + item.wire.length, 0) <=
                    64_000
                ) {
                  queue.push({ channel, wire });
                  this.pending.set(peerId, queue);
                }
                return;
              }
              await this.dispatch(channel, wire, peerId);
            }),
          ),
        );
        return {
          send: async (payload, targets) => {
            this.requireActive();
            parse(payload);
            const wire = JSON.stringify(payload);
            if (new TextEncoder().encode(wire).length > channel.maxBytes)
              throw new Error("Payload exceeds plugin channel limit");
            const eligible = modulePeers().map((p) => p.peerId);
            const chosen = targets ? [...new Set(targets)] : eligible;
            if (chosen.some((peer) => !eligible.includes(peer)))
              throw new Error("Target peer is not authorized for this plugin");
            if (chosen.length) await wireChannel.send(wire, chosen);
          },
          onMessage: (handler) => {
            const erased: MessageHandler = (value, ctx) =>
              handler(value as T, ctx);
            channel.handlers.add(erased);
            return () => channel.handlers.delete(erased);
          },
        };
      },
      onPeerJoined,
      onPeerLeft: (handler) => {
        this.departed.add(handler);
        return () => this.departed.delete(handler);
      },
    };
    return context;
  }
  private requireActive() {
    if (this.state !== "active") throw new Error("Session is not active");
    if (this.options.certificate.expiresAt <= Date.now())
      throw new Error("Session certificate expired");
  }
  private async dispatch(channel: ChannelState, wire: string, peerId: string) {
    const peer = this.accepted.get(peerId);
    if (
      !peer ||
      peer.certificate.expiresAt <= Date.now() ||
      !this.supports(peer, channel.moduleId)
    )
      throw new Error("Peer is not authorized for this plugin");
    if (new TextEncoder().encode(wire).length > channel.maxBytes)
      throw new Error("Inbound plugin payload too large");
    const value = channel.parse(JSON.parse(wire));
    for (const handler of channel.handlers)
      await handler(value, { peer: structuredClone(peer) });
  }
  private dropPeer(peerId: string) {
    const removed = this.accepted.delete(peerId);
    this.challenges.delete(peerId);
    this.pending.delete(peerId);
    this.pendingReady.delete(peerId);
    this.readyPeers.delete(peerId);
    if (removed) {
      this.notify();
      for (const handler of this.departed)
        void Promise.resolve()
          .then(() => handler(peerId))
          .catch((error) => this.report(error));
    }
  }
  private async markReady(peerId: string) {
    this.requireActive();
    if (this.accepted.has(peerId)) this.readyPeers.add(peerId);
  }
  close = (): Promise<void> => {
    if (this.closePromise) return this.closePromise;
    this.state = "closing";
    this.closePromise = this.closeInternal();
    return this.closePromise;
  };
  private async closeInternal() {
    if (this.timer) clearInterval(this.timer);
    for (const unsubscribe of this.unsubscribes.splice(0))
      try {
        unsubscribe();
      } catch (error) {
        this.report(error);
      }
    for (const plugin of [...this.initialized].reverse())
      try {
        await plugin.dispose();
      } catch (error) {
        this.report(error);
      }
    this.channels.clear();
    this.accepted.clear();
    this.challenges.clear();
    this.pending.clear();
    this.readyPeers.clear();
    this.pendingReady.clear();
    this.joined.clear();
    this.departed.clear();
    this.queues.clear();
    this.queueCounts.clear();
    try {
      await this.transport?.close();
    } finally {
      this.state = "closed";
      this.notify();
    }
  }
}
