import { z } from "zod";
import {
  envelopeDigest,
  type EncryptedEnvelope,
  type StorageAdapter,
  type StorageQuote,
} from "@/storage/storageAdapter";
import {
  recordSchema,
  type ChatRecord,
  type SaveDepth,
  type ArchiveHead,
} from "@/types/protocol";
import { type RoomClient } from "@/rooms/roomClient";
import {
  generateRoomSecret,
  encryptPayload,
  decryptEnvelope,
} from "@mycelic/room-protocol/crypto";
export { generateRoomSecret, encryptPayload };
export const depthSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full") }),
  z.object({
    kind: z.literal("last"),
    count: z.number().int().min(1).max(100_000),
  }),
  z.object({ kind: z.literal("none") }),
]);
const payloadSchema = z.object({
  version: z.literal(1),
  roomHash: z.string(),
  savedAt: z.number().int(),
  depth: depthSchema,
  messages: z.array(recordSchema).max(100_000),
});
/** Full history means all history available to this node, not all messages ever sent. */
export const filterLogs = (
  messages: readonly ChatRecord[],
  depth: SaveDepth,
): ChatRecord[] => {
  depthSchema.parse(depth);
  const sorted = [...messages].sort(
    (a, b) =>
      a.message.createdAt - b.message.createdAt ||
      a.message.id.localeCompare(b.message.id),
  );
  if (depth.kind === "none") return [];
  if (depth.kind === "last") return sorted.slice(-depth.count);
  return sorted;
};
export const serializeChatLogs = (
  roomHash: string,
  messages: readonly ChatRecord[],
  depth: SaveDepth,
  savedAt = Date.now(),
): string =>
  JSON.stringify(
    payloadSchema.parse({
      version: 1,
      roomHash,
      savedAt,
      depth,
      messages: filterLogs(messages, depth),
    }),
  );
export const decryptPayload = async (
  input: unknown,
  secret: string,
  roomHash: string,
): Promise<z.infer<typeof payloadSchema>> => {
  const payload = payloadSchema.parse(
    JSON.parse(await decryptEnvelope(input, secret, roomHash)),
  );
  if (payload.roomHash !== roomHash) throw new Error("Archive room mismatch");
  return payload;
};
export type PreparedSavepoint = {
  envelope: EncryptedEnvelope;
  quote: StorageQuote;
  savedAt: number;
  depth: SaveDepth;
  messageCount: number;
};
export const prepareSavepoint = async (input: {
  roomHash: string;
  secret: string;
  messages: readonly ChatRecord[];
  depth: SaveDepth;
  storage: StorageAdapter;
}): Promise<PreparedSavepoint> => {
  const savedAt = Date.now();
  const envelope = await encryptPayload(
    serializeChatLogs(input.roomHash, input.messages, input.depth, savedAt),
    input.secret,
    input.roomHash,
  );
  return {
    envelope,
    quote: await input.storage.quote(envelope),
    savedAt,
    depth: input.depth,
    messageCount: filterLogs(input.messages, input.depth).length,
  };
};
/** Upload then append registry head. Failure never authorizes mesh departure.
 * Retain prepared payload for a retry; content-addressed writes are idempotent.
 * Metadata-only adds a head and does not delete earlier archives. */
export const commitSavepoint = async (input: {
  prepared: PreparedSavepoint;
  storage: StorageAdapter;
  client: RoomClient;
  author: string;
}): Promise<ArchiveHead> => {
  const { prepared } = input;
  const result = await input.storage.upload(prepared.envelope, prepared.quote);
  if (result.digest !== envelopeDigest(prepared.envelope))
    throw new Error("Upload integrity check failed");
  const archive: ArchiveHead = {
    id: result.digest,
    uri: result.uri,
    digest: result.digest,
    savedAt: prepared.savedAt,
    messageCount: prepared.messageCount,
    depth: prepared.depth,
    author: input.author,
  };
  await input.client.updateRoomMetadata(
    prepared.envelope.roomHash,
    prepared.savedAt,
    result.uri,
    archive,
  );
  return archive;
};
export const restoreSavepoint = async (
  uri: string,
  secret: string,
  roomHash: string,
  storage: StorageAdapter,
): Promise<ChatRecord[]> =>
  (await decryptPayload(await storage.download(uri), secret, roomHash))
    .messages;
