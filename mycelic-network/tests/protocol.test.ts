import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256 } from "viem";
import {
  canonical,
  unsigned,
  type RoomDefinition,
  type ChatRecord,
  type SessionCertificate,
  type ArchiveHead,
} from "@/types/protocol";
import {
  signRoom,
  verifyRoom,
  assertAccess,
  issueInvitation,
  verifyCertificate,
  verifyInvitation,
} from "@/access/roomAccess";
import { RoomRegistry } from "@/rooms/roomRegistry";
import type { RoomClient } from "@/rooms/roomClient";
import {
  generateRoomSecret,
  filterLogs,
  serializeChatLogs,
  encryptPayload,
  decryptPayload,
  prepareSavepoint,
  commitSavepoint,
  restoreSavepoint,
} from "@/utils/savepointEngine";
import {
  envelopeDigest,
  type StorageAdapter,
  type EncryptedEnvelope,
} from "@/storage/storageAdapter";
import { verifyRecord } from "@/mesh/ChatMesh";
const owner = privateKeyToAccount(generatePrivateKey());
const issuer = privateKeyToAccount(generatePrivateKey());
const roomFactory = async (
  overrides: Partial<RoomDefinition> = {},
): Promise<RoomDefinition> =>
  signRoom(
    {
      hash: keccak256(`0x${generateRoomSecret()}`),
      owner: owner.address,
      title: "Test room",
      createdAt: Date.now(),
      policy: { mode: "group", allowlist: [], inviteRequired: false },
      ...overrides,
    },
    owner,
  );
const certFactory = async (
  room: RoomDefinition,
): Promise<SessionCertificate> => {
  const body = {
    roomHash: room.hash,
    identity: owner.address,
    session: owner.address,
    expiresAt: Date.now() + 60_000,
  };
  return {
    ...body,
    signature: await owner.signMessage({ message: canonical(body) }),
  };
};
const recordFactory = async (
  room: RoomDefinition,
  text = "Hello",
): Promise<ChatRecord> => {
  const certificate = await certFactory(room);
  const body = {
    id: crypto.randomUUID(),
    roomHash: room.hash,
    sender: owner.address,
    session: owner.address,
    text,
    createdAt: Date.now(),
  };
  const message = {
    ...body,
    signature: await owner.signMessage({ message: canonical(body) }),
  };
  return { message, certificate };
};
const mockStorage = (): StorageAdapter => {
  const objects = new Map<string, EncryptedEnvelope>();
  return {
    mode: "local",
    quote: async (envelope) => ({
      bytes: JSON.stringify(envelope).length,
      expiresAt: Date.now() + 60_000,
      provider: "test",
      quoteId: "test",
      digest: envelopeDigest(envelope),
    }),
    upload: async (envelope) => {
      const digest = envelopeDigest(envelope);
      const uri = `demo://${digest}`;
      objects.set(uri, envelope);
      return { uri, digest };
    },
    download: async (uri) => {
      const value = objects.get(uri);
      if (!value) throw new Error("Missing");
      return value;
    },
  };
};
describe("access control and session proofs", () => {
  it("verifies signed immutable policies and rejects policy tampering", async () => {
    const room = await roomFactory();
    expect(await verifyRoom(room)).toEqual(room);
    await expect(
      verifyRoom({ ...room, title: "Forged policy" }),
    ).rejects.toThrow("signature");
  });
  it("requires two distinct identities in a direct room", async () => {
    await expect(
      roomFactory({
        policy: {
          mode: "direct",
          allowlist: [owner.address],
          inviteRequired: false,
        },
      }),
    ).rejects.toThrow("two distinct");
    await expect(
      roomFactory({
        policy: {
          mode: "direct",
          allowlist: [owner.address, owner.address.toLowerCase()],
          inviteRequired: false,
        },
      }),
    ).rejects.toThrow("two distinct");
    const room = await roomFactory({
      policy: {
        mode: "direct",
        allowlist: [owner.address, issuer.address],
        inviteRequired: false,
      },
    });
    await expect(assertAccess(room, issuer.address)).resolves.toBeUndefined();
    await expect(
      assertAccess(room, privateKeyToAccount(generatePrivateKey()).address),
    ).rejects.toThrow("allowlist");
  });
  it("binds invites to wallet, room, owner and expiry", async () => {
    const room = await roomFactory({
      policy: { mode: "group", allowlist: [], inviteRequired: true },
    });
    const invite = await issueInvitation(
      room,
      issuer.address,
      Date.now() + 60_000,
      owner,
    );
    expect(await verifyInvitation(room, issuer.address, invite)).toBe(true);
    expect(await verifyInvitation(room, owner.address, invite)).toBe(false);
    expect(
      await verifyInvitation(room, issuer.address, { ...invite, expiresAt: 1 }),
    ).toBe(false);
    expect(
      await verifyInvitation(
        { ...room, hash: keccak256("0x01") },
        issuer.address,
        invite,
      ),
    ).toBe(false);
    await expect(
      assertAccess(room, issuer.address, invite),
    ).resolves.toBeUndefined();
    await expect(assertAccess(room, issuer.address)).rejects.toThrow(
      "invitation",
    );
    await expect(
      issueInvitation(room, issuer.address, Date.now() + 60_000, issuer),
    ).rejects.toThrow("owner");
  });
  it("ANDs wallet and NFT gates and fails closed on RPC failure", async () => {
    const room = await roomFactory({
      policy: {
        mode: "group",
        allowlist: [owner.address],
        inviteRequired: false,
        nft: { chainId: 8453, contract: issuer.address, standard: "erc721" },
      },
    });
    await expect(
      assertAccess(room, owner.address, undefined, async () => 1n),
    ).resolves.toBeUndefined();
    await expect(
      assertAccess(room, owner.address, undefined, async () => 0n),
    ).rejects.toThrow("NFT");
    await expect(
      assertAccess(room, issuer.address, undefined, async () => 1n),
    ).rejects.toThrow("allowlist");
    await expect(
      assertAccess(room, owner.address, undefined, async () => {
        throw new Error("RPC unavailable");
      }),
    ).rejects.toThrow("RPC");
  });
  it("rejects session expiry, room reuse and identity forgery", async () => {
    const room = await roomFactory();
    const cert = await certFactory(room);
    expect(await verifyCertificate(cert, room.hash)).toEqual(cert);
    await expect(verifyCertificate(cert, keccak256("0x01"))).rejects.toThrow(
      "invalid",
    );
    await expect(
      verifyCertificate({ ...cert, expiresAt: 1 }, room.hash),
    ).rejects.toThrow("Expired");
    await expect(
      verifyCertificate({ ...cert, identity: issuer.address }, room.hash),
    ).rejects.toThrow("signature");
  });
});
describe("AES-GCM savepoints", () => {
  it("filters sorted Full, Last N and None and rejects zero/negative windows", async () => {
    const room = await roomFactory();
    const registry = new RoomRegistry();
    registry.create(room, owner.address);
    const records = await Promise.all(
      ["one", "two", "three"].map((text) => recordFactory(room, text)),
    );
    records.forEach((record, index) => (record.message.createdAt = index + 1));
    expect(filterLogs([...records].reverse(), { kind: "full" })).toEqual(
      records,
    );
    expect(filterLogs(records, { kind: "last", count: 2 })).toEqual(
      records.slice(1),
    );
    expect(filterLogs(records, { kind: "none" })).toEqual([]);
    expect(() => filterLogs(records, { kind: "last", count: 0 })).toThrow();
    expect(() => filterLogs(records, { kind: "last", count: -1 })).toThrow();
    expect(filterLogs(records, { kind: "last", count: 500 })).toHaveLength(3);
  });
  it("round-trips Unicode and uses a different nonce/salt for each save", async () => {
    const room = await roomFactory();
    const registry = new RoomRegistry();
    registry.create(room, owner.address);
    const records = [await recordFactory(room, "Hello 👋 مرحبا")];
    const secret = generateRoomSecret();
    const json = serializeChatLogs(room.hash, records, { kind: "full" });
    const first = await encryptPayload(json, secret, room.hash);
    const second = await encryptPayload(json, secret, room.hash);
    expect(first.iv).not.toBe(second.iv);
    expect(first.salt).not.toBe(second.salt);
    expect(first.ciphertext).not.toContain("Hello");
    expect((await decryptPayload(first, secret, room.hash)).messages).toEqual(
      records,
    );
  });
  it("rejects wrong keys, changed ciphertext, wrong rooms and invalid secrets", async () => {
    const room = await roomFactory();
    const secret = generateRoomSecret();
    const payload = serializeChatLogs(room.hash, [], { kind: "none" });
    const envelope = await encryptPayload(payload, secret, room.hash);
    await expect(
      decryptPayload(envelope, generateRoomSecret(), room.hash),
    ).rejects.toThrow();
    const tampered = {
      ...envelope,
      ciphertext:
        (envelope.ciphertext.startsWith("00") ? "01" : "00") +
        envelope.ciphertext.slice(2),
    };
    await expect(decryptPayload(tampered, secret, room.hash)).rejects.toThrow();
    await expect(
      decryptPayload(envelope, secret, keccak256("0x01")),
    ).rejects.toThrow("another room");
    await expect(
      encryptPayload(payload, "short password", room.hash),
    ).rejects.toThrow("32 random bytes");
  });
  it("commits upload before metadata and restores the selected window", async () => {
    const room = await roomFactory();
    const registry = new RoomRegistry();
    registry.create(room, owner.address);
    const records = [
      await recordFactory(room, "one"),
      await recordFactory(room, "two"),
    ];
    const secret = generateRoomSecret();
    const storage = mockStorage();
    const prepared = await prepareSavepoint({
      roomHash: room.hash,
      secret,
      messages: records,
      depth: { kind: "last", count: 1 },
      storage,
    });
    const update = vi.fn(async () => {});
    const client = {
      updateRoomMetadata: update,
    } as unknown as RoomClient;
    const head = await commitSavepoint({
      prepared,
      storage,
      client,
      author: owner.address,
    });
    expect(update).toHaveBeenCalledWith(
      room.hash,
      prepared.savedAt,
      head.uri,
      head,
    );
    expect(
      await restoreSavepoint(head.uri, secret, room.hash, storage),
    ).toEqual(filterLogs(records, { kind: "last", count: 1 }));
  });
  it("never updates metadata on failed upload and propagates registry failures", async () => {
    const room = await roomFactory();
    const secret = generateRoomSecret();
    const storage = mockStorage();
    const prepared = await prepareSavepoint({
      roomHash: room.hash,
      secret,
      messages: [],
      depth: { kind: "none" },
      storage,
    });
    const update = vi.fn(async () => {});
    const client = {
      updateRoomMetadata: update,
    } as unknown as RoomClient;
    await expect(
      commitSavepoint({
        prepared,
        client,
        storage: {
          ...storage,
          upload: async () => {
            throw new Error("Offline");
          },
        },
        author: owner.address,
      }),
    ).rejects.toThrow("Offline");
    expect(update).not.toHaveBeenCalled();
    await expect(
      commitSavepoint({
        prepared,
        storage,
        client: {
          updateRoomMetadata: async () => {
            throw new Error("Registry offline");
          },
        } as unknown as RoomClient,
        author: owner.address,
      }),
    ).rejects.toThrow("Registry offline");
  });
});
describe("room lifecycle metadata", () => {
  it("expires crashed node leases and enters hibernation after zero leases", async () => {
    let now = Date.now();
    const registry = new RoomRegistry(() => now);
    const room = await roomFactory();
    registry.create(room, owner.address);
    registry.heartbeat(room.hash, owner.address, "one");
    registry.heartbeat(room.hash, issuer.address, "two");
    expect(registry.metadata(room.hash).activePeerCount).toBe(2);
    registry.release(room.hash, owner.address, "one");
    expect(registry.metadata(room.hash).activePeerCount).toBe(1);
    const head: ArchiveHead = {
      id: "archive",
      uri: "demo://archive",
      digest: "archive",
      savedAt: now,
      messageCount: 0,
      depth: { kind: "none" },
      author: owner.address,
    };
    registry.save(room.hash, head, owner.address);
    now += 46_000;
    expect(registry.metadata(room.hash).status).toBe("hibernating");
    expect(registry.metadata(room.hash).activePeerCount).toBe(0);
  });
  it("retains racing savepoints and a metadata-only head does not erase earlier archives", async () => {
    const now = Date.now();
    const registry = new RoomRegistry(() => now);
    const room = await roomFactory();
    registry.create(room, owner.address);
    const head = (id: string, savedAt: number): ArchiveHead => ({
      id,
      uri: `demo://${id}`,
      digest: id,
      savedAt,
      messageCount: 10,
      depth: { kind: "full" },
      author: owner.address,
    });
    registry.save(room.hash, head("new", now), owner.address);
    registry.save(room.hash, head("old", now - 1_000), owner.address);
    expect(registry.metadata(room.hash).storageUri).toBe("demo://new");
    expect(registry.metadata(room.hash).archives).toHaveLength(2);
    registry.save(
      room.hash,
      { ...head("meta", now + 1), depth: { kind: "none" }, messageCount: 0 },
      owner.address,
    );
    expect(registry.metadata(room.hash).archives).toHaveLength(3);
  });
});
describe("receiver checks", () => {
  it("accepts signed free messages and rejects spoofed authors or changed content", async () => {
    const registry = new RoomRegistry();
    const room = await roomFactory();
    registry.create(room, owner.address);
    const record = await recordFactory(room);
    expect(await verifyRecord(record, room)).toEqual(record);
    await expect(
      verifyRecord(
        { ...record, message: { ...record.message, sender: issuer.address } },
        room,
      ),
    ).rejects.toThrow("identity");
    await expect(
      verifyRecord(
        { ...record, message: { ...record.message, text: "Forged text" } },
        room,
      ),
    ).rejects.toThrow("signature");
    const forgedCertificate = {
      ...record.certificate,
      identity: issuer.address,
    };
    await expect(
      verifyRecord({ ...record, certificate: forgedCertificate }, room),
    ).rejects.toThrow();
    expect(unsigned(record.message)).not.toHaveProperty("signature");
  });
});

describe("free room registration", () => {
  it("registers without funding and rejects wrong owners and duplicate rooms", async () => {
    const room = await roomFactory();
    const registry = new RoomRegistry();
    expect(() => registry.create(room, issuer.address)).toThrow("owner");
    registry.create(room, owner.address);
    expect(registry.metadata(room.hash).room).toEqual(room);
    expect(() => registry.create(room, owner.address)).toThrow(
      "already exists",
    );
  });
});
