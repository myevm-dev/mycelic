import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { canonical, type PaymentPolicy } from "@/types/protocol";
import { dataDirectory } from "./config";
import {
  PaymentLedger,
  identityError,
  type LedgerCollection,
  type LedgerRecords,
  type LedgerTransaction,
} from "./ledger";

const tables: Record<LedgerCollection, { keys: string[]; fields: string[] }> = {
  rooms: { keys: ["hash"], fields: ["hash", "definition", "receipt"] },
  credits: { keys: ["wallet"], fields: ["wallet", "amount"] },
  posts: { keys: ["room", "id"], fields: ["room", "id", "digest", "receipt"] },
  intents: {
    keys: ["id"],
    fields: [
      "id",
      "owner",
      "kind",
      "data",
      "amount",
      "expires",
      "status",
      "nonce",
      "payload",
      "result",
      "error",
    ],
  },
  creation_claims: { keys: ["room"], fields: ["room", "intent"] },
  nonces: { keys: ["nonce"], fields: ["nonce", "intent"] },
  settings: { keys: ["name"], fields: ["name", "value"] },
  room_leases: { keys: ["room"], fields: ["room", "members"] },
  rate_windows: { keys: ["bucket"], fields: ["bucket", "window", "count"] },
};

/** SQLite remains available for local development and a single persistent Node server. */
export class PaymentStore extends PaymentLedger {
  readonly backend = "sqlite" as const;
  readonly db: DatabaseSync;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    path = join(
      dataDirectory(),
      `mycelic-${process.env.MYCELIC_PAYMENT_ENV === "mainnet" ? "mainnet" : "testnet"}.sqlite`,
    ),
  ) {
    super();
    if (path !== ":memory:")
      mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS rooms(hash TEXT PRIMARY KEY, definition TEXT NOT NULL, receipt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credits(wallet TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount>=0));
      CREATE TABLE IF NOT EXISTS posts(room TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(room,id));
      CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL,amount TEXT NOT NULL,expires INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'ready',nonce TEXT UNIQUE,payload TEXT,result TEXT,error TEXT);
      CREATE TABLE IF NOT EXISTS settings(name TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS creation_claims(room TEXT PRIMARY KEY,intent TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS leases(room TEXT NOT NULL,actor TEXT NOT NULL,lease TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(room,actor));
      CREATE TABLE IF NOT EXISTS room_leases(room TEXT PRIMARY KEY,members TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY,intent TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS rate_windows(bucket TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS intent_expiry ON intents(expires);
      INSERT OR IGNORE INTO nonces(nonce,intent) SELECT lower(nonce),id FROM intents WHERE nonce IS NOT NULL;
      INSERT OR IGNORE INTO creation_claims(room,intent) SELECT json_extract(data,'$.room.hash'),id FROM intents WHERE kind='create' AND status IN ('ready','pending','accepted') ORDER BY expires;
      INSERT OR IGNORE INTO room_leases(room,members) SELECT room,json_group_object(actor,json_object('lease',lease,'expires',expires)) FROM leases GROUP BY room;
      DELETE FROM leases;
    `);
  }
  private read<C extends LedgerCollection>(
    collection: C,
    key: string,
  ): LedgerRecords[C] | undefined {
    const spec = tables[collection];
    const values =
      collection === "posts" ? (JSON.parse(key) as string[]) : [key];
    const row = this.db
      .prepare(
        `SELECT * FROM ${collection} WHERE ${spec.keys.map((k) => `${k}=?`).join(" AND ")}`,
      )
      .get(...values);
    if (row && collection === "room_leases")
      row.members = JSON.parse(row.members as string);
    return row as LedgerRecords[C] | undefined;
  }
  async transaction<T>(fn: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn({
          get: async (collection, key) => this.read(collection, key),
          set: (collection, _key, record) => {
            const { keys, fields } = tables[collection];
            const values = fields.map((field) => {
              const value = (
                record as unknown as Record<string, string | number | null>
              )[field];
              return field === "members" ? JSON.stringify(value) : value;
            });
            this.db
              .prepare(
                `INSERT INTO ${collection}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")}) ON CONFLICT(${keys.join(",")}) DO UPDATE SET ${fields
                  .filter((f) => !keys.includes(f))
                  .map((f) => `${f}=excluded.${f}`)
                  .join(",")}`,
              )
              .run(...values);
          },
          delete: (collection, key) => {
            const values =
              collection === "posts" ? (JSON.parse(key) as string[]) : [key];
            this.db
              .prepare(
                `DELETE FROM ${collection} WHERE ${tables[collection].keys.map((k) => `${k}=?`).join(" AND ")}`,
              )
              .run(...values);
          },
        });
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async get<C extends LedgerCollection>(collection: C, key: string) {
    await this.queue;
    return this.read(collection, key);
  }
  async list<C extends LedgerCollection>(
    collection: C,
  ): Promise<LedgerRecords[C][]> {
    await this.queue;
    return this.db
      .prepare(`SELECT * FROM ${collection}`)
      .all()
      .map((row) => {
        if (collection === "room_leases")
          row.members = JSON.parse(row.members as string);
        return row as LedgerRecords[C];
      });
  }
  override async pinPolicy(policy: PaymentPolicy) {
    await this.transaction(async (tx) => {
      const wanted = canonical(policy);
      const pinned = await tx.get("settings", "payment-policy");
      const mismatch = this.db
        .prepare(
          "SELECT 1 FROM rooms WHERE COALESCE(json_extract(definition,'$.payment'),'')<>? LIMIT 1",
        )
        .get(wanted);
      if ((pinned && pinned.value !== wanted) || (!pinned && mismatch))
        throw identityError();
      if (!pinned)
        tx.set("settings", "payment-policy", {
          name: "payment-policy",
          value: wanted,
        });
    });
  }
  async close() {
    await this.queue;
    this.db.close();
  }
}
const globals = globalThis as typeof globalThis & {
  mycelicPaymentStore?: Promise<PaymentLedger>;
};
export function paymentStore(): Promise<PaymentLedger> {
  if (!globals.mycelicPaymentStore) {
    const backend =
      process.env.MYCELIC_STORAGE_BACKEND ||
      (process.env.VERCEL ? "firestore" : "sqlite");
    globals.mycelicPaymentStore = (async () => {
      if (backend === "firestore") {
        const { createFirestoreStore } = await import("./firestoreStore");
        return createFirestoreStore();
      }
      if (backend !== "sqlite")
        throw new Error("MYCELIC_STORAGE_BACKEND must be firestore or sqlite");
      if (process.env.VERCEL)
        throw new Error(
          "Vercel payments require MYCELIC_STORAGE_BACKEND=firestore. Local SQLite is not persistent on Vercel.",
        );
      return new PaymentStore();
    })().catch((error) => {
      globals.mycelicPaymentStore = undefined;
      throw error;
    });
  }
  return globals.mycelicPaymentStore;
}
