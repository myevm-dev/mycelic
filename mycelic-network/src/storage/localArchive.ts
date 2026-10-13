import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  envelopeSchema,
  envelopeDigest,
  type EncryptedEnvelope,
} from "./storageAdapter";
const directory = () => join(process.cwd(), ".demo-data", "blobs");
export const writeLocalArchive = async (
  input: unknown,
): Promise<{ uri: string; digest: string }> => {
  const envelope = envelopeSchema.parse(input);
  const digest = envelopeDigest(envelope);
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  await writeFile(
    join(directory(), `${digest}.json`),
    JSON.stringify(envelope),
    { mode: 0o600 },
  );
  return { uri: `demo://${digest}`, digest };
};
export const readLocalArchive = async (
  digest: string,
): Promise<EncryptedEnvelope> => {
  if (!/^0x[0-9a-f]{64}$/.test(digest))
    throw new Error("Invalid archive digest");
  const envelope = envelopeSchema.parse(
    JSON.parse(await readFile(join(directory(), `${digest}.json`), "utf8")),
  );
  if (envelopeDigest(envelope) !== digest)
    throw new Error("Archive checksum mismatch");
  return envelope;
};
