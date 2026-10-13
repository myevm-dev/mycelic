import {
  envelopeSchema,
  envelopeDigest,
  type EncryptedEnvelope,
} from "@mycelic/room-protocol/crypto";
export { envelopeSchema, envelopeDigest, type EncryptedEnvelope };
export type StorageQuote = {
  bytes: number;
  expiresAt: number;
  provider: string;
  quoteId: string;
  digest: string;
};
export interface StorageAdapter {
  readonly mode: "local";
  quote(envelope: EncryptedEnvelope): Promise<StorageQuote>;
  upload(
    envelope: EncryptedEnvelope,
    quote: StorageQuote,
  ): Promise<{ uri: string; digest: string }>;
  download(uri: string): Promise<EncryptedEnvelope>;
}
/** Local ciphertext persistence only. No IPFS pin or permanent-storage claim. */
export class LocalStorageAdapter implements StorageAdapter {
  readonly mode = "local" as const;
  async quote(envelope: EncryptedEnvelope): Promise<StorageQuote> {
    return {
      bytes: new TextEncoder().encode(JSON.stringify(envelope)).length,
      expiresAt: Date.now() + 60_000,
      provider: "Local encrypted savepoint store",
      quoteId: crypto.randomUUID(),
      digest: envelopeDigest(envelope),
    };
  }
  async upload(envelope: EncryptedEnvelope, quote: StorageQuote) {
    if (
      quote.expiresAt < Date.now() ||
      quote.digest !== envelopeDigest(envelope)
    )
      throw new Error("Savepoint preview expired or changed");
    const response = await fetch("/api/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Ciphertext upload failed");
    if (data.digest !== envelopeDigest(envelope))
      throw new Error("Storage checksum mismatch");
    return data as { uri: string; digest: string };
  }
  async download(uri: string) {
    if (!/^demo:\/\/0x[0-9a-f]{64}$/.test(uri))
      throw new Error("Unsupported demo storage URI");
    const response = await fetch(`/api/archive?digest=${uri.slice(7)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Archive unavailable");
    const envelope = envelopeSchema.parse(await response.json());
    if (envelopeDigest(envelope) !== uri.slice(7))
      throw new Error("Archive checksum mismatch");
    return envelope;
  }
}
