import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, hashMessage } from "viem";
import {
  RoomSession,
  canonical,
  generateRoomSecret,
  chatProtocol,
  roomProtocolSchema,
  assertCapabilities,
  type RoomDefinition,
  type RoomProtocol,
  type SessionCertificate,
  type RoomModule,
  type ModuleContext,
  type ModuleChannel,
  type RoomTransport,
  type WireChannel,
  type Capability,
} from "@mycelic/room-protocol";
import { signRoom, assertAccess } from "@/access/roomAccess";

type Listener = (wire: string, peerId: string) => void;
class FakeTransport implements RoomTransport {
  readonly peerId = "local-peer";
  readonly support = {
    reliableOrdered: true,
    unreliableUnordered: false,
  };
  connections = new Set<string>();
  joins = new Set<(id: string) => void>();
  leaves = new Set<(id: string) => void>();
  sent: { name: string; wire: string; targets: readonly string[] }[] = [];
  listeners = new Map<string, Set<Listener>>();
  peers = () => [...this.connections];
  onJoin = (handler: (id: string) => void) => {
    this.joins.add(handler);
    return () => this.joins.delete(handler);
  };
  onLeave = (handler: (id: string) => void) => {
    this.leaves.add(handler);
    return () => this.leaves.delete(handler);
  };
  channel = (name: string): WireChannel => ({
    send: async (wire, targets) => {
      this.sent.push({ name, wire, targets });
    },
    receive: (handler) => {
      const set = this.listeners.get(name) ?? new Set();
      set.add(handler);
      this.listeners.set(name, set);
      return () => set.delete(handler);
    },
  });
  close = vi.fn(async () => {});
  connect(id = "remote-peer") {
    this.connections.add(id);
    for (const handler of this.joins) handler(id);
  }
  disconnect(id = "remote-peer") {
    this.connections.delete(id);
    for (const handler of this.leaves) handler(id);
  }
  input(name: string, data: unknown, id = "remote-peer") {
    for (const handler of this.listeners.get(name) ?? [])
      handler(JSON.stringify(data), id);
  }
}
const certificate = async (
  room: RoomDefinition,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<SessionCertificate> => {
  const body = {
    roomHash: room.hash,
    identity: account.address,
    session: account.address,
    expiresAt: Date.now() + 60_000,
  };
  return {
    ...body,
    signature: await account.signMessage({ message: canonical(body) }),
  };
};
const counter = () => {
  let channel: ModuleChannel<{ value: number }> | undefined;
  const received = vi.fn();
  const joined = vi.fn();
  const disposed = vi.fn();
  const plugin: RoomModule = {
    definition: {
      id: "test.counter",
      version: 1,
      channels: [{ name: "events", maxBytes: 100 }],
    },
    setup: (context: ModuleContext) => {
      channel = context.channel("events", (input) =>
        z.object({ value: z.number().int() }).strict().parse(input),
      );
      channel.onMessage(received);
      context.onPeerJoined(joined);
    },
    dispose: disposed,
  };
  return { plugin, received, joined, disposed, channel: () => channel! };
};
const fixture = async (
  protocol: RoomProtocol | null = {
    version: 1,
    modules: [{ id: "test.counter", version: 1, required: true }],
  },
) => {
  const local = privateKeyToAccount(generatePrivateKey());
  const remote = privateKeyToAccount(generatePrivateKey());
  const room = await signRoom(
    {
      hash: keccak256(`0x${generateRoomSecret()}`),
      owner: local.address,
      title: "SDK test",
      createdAt: Date.now(),
      policy: { mode: "group", allowlist: [], inviteRequired: false },
      ...(protocol ? { protocol } : {}),
    },
    local,
  );
  const transport = new FakeTransport();
  const errors: Error[] = [];
  const createTransport = vi.fn(() => transport);
  const session = new RoomSession({
    room,
    account: local,
    certificate: await certificate(room, local),
    createTransport,
    authorize: assertAccess,
    onError: (error) => errors.push(error),
  });
  return { room, local, remote, transport, errors, session, createTransport };
};
const authenticate = async (
  f: Awaited<ReturnType<typeof fixture>>,
  capabilities: Capability[] | undefined = f.room.protocol?.modules,
  modify?: (data: Record<string, unknown>) => Record<string, unknown>,
) => {
  const peerId = "remote-peer";
  if (!f.transport.connections.has(peerId)) f.transport.connect(peerId);
  const request = JSON.parse(
    f.transport.sent.filter((s) => s.name === "v1.challenge").at(-1)!.wire,
  );
  const proof = await f.remote.signMessage({
    message: canonical({
      roomHash: f.room.hash,
      nonce: request.nonce,
      peerId,
      requester: f.transport.peerId,
      ...(capabilities ? { capabilities } : {}),
    }),
  });
  const data = {
    certificate: await certificate(f.room, f.remote),
    nonce: request.nonce,
    proof,
    ...(capabilities ? { capabilities } : {}),
  };
  f.transport.input("v1.auth", modify ? modify(data) : data);
};
// Derive the public channel namespace exactly as the protocol specifies, rather than inspecting private state.
const eventWire = (id = "test.counter") =>
  `m.${hashMessage(`${id}@1:events`).slice(2, 18)}`;
describe("versioned protocol compatibility", () => {
  it("keeps legacy rooms unsigned fields unchanged and defaults their capability to chat", async () => {
    const f = await fixture(null);
    const plugin: RoomModule = {
      definition: { id: "ember.chat", version: 1, channels: [] },
      setup: () => {},
      dispose: () => {},
    };
    f.session.install(plugin);
    await f.session.start();
    expect(f.room).not.toHaveProperty("protocol");
    await authenticate(f, undefined);
    await vi.waitFor(() => expect(f.session.peers()).toHaveLength(1));
    await f.session.close();
  });
  it("rejects duplicate and unsupported manifest versions", () => {
    expect(() =>
      roomProtocolSchema.parse({ version: 2, modules: chatProtocol().modules }),
    ).toThrow();
    expect(() =>
      roomProtocolSchema.parse({
        version: 1,
        modules: [...chatProtocol().modules, ...chatProtocol().modules],
      }),
    ).toThrow("unique");
    expect(() =>
      assertCapabilities(
        {
          version: 1,
          modules: [{ id: "test.missing", version: 1, required: true }],
        },
        chatProtocol().modules,
      ),
    ).toThrow("test.missing");
  });
  it("does not open a connection if a required module is missing", async () => {
    const f = await fixture();
    await expect(f.session.start()).rejects.toThrow(
      "Required module unavailable",
    );
    expect(f.createTransport).not.toHaveBeenCalled();
  });
  it("rejects a tampered signed room manifest before transport creation", async () => {
    const f = await fixture();
    f.room.title = "tampered";
    const plugin = counter();
    f.session.install(plugin.plugin);
    await expect(f.session.start()).rejects.toThrow("signature");
    expect(f.createTransport).not.toHaveBeenCalled();
  });
  it("requires modules to be declared, uniquely installed and installed before start", async () => {
    const f = await fixture();
    const plugin = counter();
    f.session.install(plugin.plugin);
    expect(() => f.session.install(counter().plugin)).toThrow("Duplicate");
    expect(() =>
      f.session.install({
        definition: { id: "test.undeclared", version: 1, channels: [] },
        setup: () => {},
        dispose: () => {},
      }),
    ).toThrow("not declared");
    await f.session.start();
    expect(() => f.session.install(counter().plugin)).toThrow(
      "before starting",
    );
    await f.session.close();
  });
});
describe("authenticated modular channels", () => {
  it("dispatches validated payloads only after peer authentication", async () => {
    const f = await fixture();
    const plugin = counter();
    f.session.install(plugin.plugin);
    await f.session.start();
    f.transport.connect();
    f.transport.input(eventWire(), { value: 7 });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(plugin.received).not.toHaveBeenCalled();
    await authenticate(f);
    await vi.waitFor(() => expect(plugin.received).toHaveBeenCalledOnce());
    expect(plugin.received.mock.calls[0][0]).toEqual({ value: 7 });
    expect(plugin.received.mock.calls[0][1].peer.certificate.identity).toBe(
      f.remote.address,
    );
    await f.session.close();
  });
  it("rejects forged capability claims and admits no peer", async () => {
    const f = await fixture();
    f.session.install(counter().plugin);
    await f.session.start();
    await authenticate(f, f.room.protocol!.modules, (data) => ({
      ...data,
      capabilities: [{ id: "test.counter", version: 2, required: true }],
    }));
    await vi.waitFor(() =>
      expect(
        f.errors.some((e) => e.message.includes("proof of session key")),
      ).toBe(true),
    );
    expect(f.session.peers()).toEqual([]);
    await f.session.close();
  });
  it("fails closed when the peer lacks a required module", async () => {
    const f = await fixture();
    f.session.install(counter().plugin);
    await f.session.start();
    await authenticate(f, chatProtocol().modules);
    await vi.waitFor(() =>
      expect(
        f.errors.some((e) => e.message.includes("Required module unavailable")),
      ).toBe(true),
    );
    expect(f.session.peers()).toHaveLength(0);
    await f.session.close();
  });
  it("rejects expired peer certificates", async () => {
    const f = await fixture();
    f.session.install(counter().plugin);
    await f.session.start();
    await authenticate(f, f.room.protocol!.modules, (data) => ({
      ...data,
      certificate: {
        ...(data.certificate as SessionCertificate),
        expiresAt: 1,
      },
    }));
    await vi.waitFor(() =>
      expect(f.errors.some((e) => e.message.includes("Expired"))).toBe(true),
    );
    expect(f.session.peers()).toHaveLength(0);
    await f.session.close();
  });
  it("checks channel schemas, byte limits and explicit target authorization", async () => {
    const f = await fixture();
    const plugin = counter();
    f.session.install(plugin.plugin);
    await f.session.start();
    await expect(
      plugin.channel().send({ value: 1 }, ["unverified-peer"]),
    ).rejects.toThrow("not authorized");
    await authenticate(f);
    await vi.waitFor(() => expect(f.session.peers()).toHaveLength(1));
    await plugin.channel().send({ value: 42 });
    expect(f.transport.sent.at(-1)).toMatchObject({
      name: eventWire(),
      targets: ["remote-peer"],
    });
    f.transport.input(eventWire(), { value: "invalid" });
    await vi.waitFor(() => expect(f.errors.length).toBeGreaterThan(0));
    expect(plugin.received).not.toHaveBeenCalled();
    await f.session.close();
    await expect(plugin.channel().send({ value: 1 })).rejects.toThrow(
      "not active",
    );
  });
  it("does not send optional-module traffic to clients without that capability", async () => {
    const f = await fixture({
      version: 1,
      modules: [
        { id: "test.counter", version: 1, required: true },
        { id: "test.optional", version: 1, required: false },
      ],
    });
    const plugin = counter();
    let optional: ModuleChannel<{ value: number }> | undefined;
    f.session.install(plugin.plugin).install({
      definition: {
        id: "test.optional",
        version: 1,
        channels: [{ name: "events", maxBytes: 100 }],
      },
      setup: (context) => {
        optional = context.channel("events", (input) =>
          z.object({ value: z.number() }).parse(input),
        );
      },
      dispose: () => {},
    });
    await f.session.start();
    await authenticate(f, [{ id: "test.counter", version: 1, required: true }]);
    await vi.waitFor(() => expect(f.session.peers()).toHaveLength(1));
    await optional!.send({ value: 1 });
    expect(
      f.transport.sent.some((s) => s.name === eventWire("test.optional")),
    ).toBe(false);
    await expect(optional!.send({ value: 1 }, ["remote-peer"])).rejects.toThrow(
      "not authorized",
    );
    await f.session.close();
  });
  it("cleans initialized modules and transport if a later module setup fails", async () => {
    const f = await fixture({
      version: 1,
      modules: [
        { id: "test.counter", version: 1, required: true },
        { id: "test.failing", version: 1, required: true },
      ],
    });
    const plugin = counter();
    const failedDispose = vi.fn();
    f.session.install(plugin.plugin).install({
      definition: { id: "test.failing", version: 1, channels: [] },
      setup: () => {
        throw new Error("setup failure");
      },
      dispose: failedDispose,
    });
    await expect(f.session.start()).rejects.toThrow("setup failure");
    expect(plugin.disposed).toHaveBeenCalledOnce();
    expect(failedDispose).toHaveBeenCalledOnce();
    expect(f.transport.close).toHaveBeenCalledOnce();
    await f.session.close();
    expect(f.transport.close).toHaveBeenCalledOnce();
    await expect(f.session.start()).rejects.toThrow("closed");
  });
});
