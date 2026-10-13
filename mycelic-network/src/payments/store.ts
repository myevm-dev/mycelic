import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { canonical, type PaymentPolicy } from "@/types/protocol";
import { dataDirectory } from "./config";
/** Persistent money ledger and public room metadata only. Never stores chat text or room secrets. */
export class PaymentStore {
  readonly db: DatabaseSync;
  constructor(
    path = join(
      dataDirectory(),
      `mycelic-${process.env.MYCELIC_PAYMENT_ENV === "mainnet" ? "mainnet" : "testnet"}.sqlite`,
    ),
  ) {
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
      CREATE TABLE IF NOT EXISTS rate_windows(bucket TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS leases_expiry ON leases(expires);
      CREATE INDEX IF NOT EXISTS intent_expiry ON intents(expires);
      INSERT OR IGNORE INTO creation_claims(room,intent) SELECT json_extract(data,'$.room.hash'),id FROM intents WHERE kind='create' AND status IN ('ready','pending','accepted') ORDER BY expires;
    `);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  pinPolicy(policy: PaymentPolicy) {
    this.transaction(() => {
      const wanted = canonical(policy);
      const pinned = this.db
        .prepare("SELECT value FROM settings WHERE name='payment-policy'")
        .get() as { value: string } | undefined;
      const legacyMismatch = this.db
        .prepare(
          "SELECT 1 FROM rooms WHERE COALESCE(json_extract(definition,'$.payment'),'')<>? LIMIT 1",
        )
        .get(wanted);
      if ((pinned && pinned.value !== wanted) || (!pinned && legacyMismatch))
        throw new Error(
          "Payment identity differs from the ledger. Restore the original receipt key, treasury and service ID, or perform a reviewed migration.",
        );
      this.db
        .prepare(
          "INSERT OR IGNORE INTO settings(name,value) VALUES('payment-policy',?)",
        )
        .run(wanted);
    });
  }
  rateLimit(wallet: string, group: string, limit: number, now = Date.now()) {
    const window = Math.floor(now / 60000),
      bucket = `${group}:${wallet.toLowerCase()}`;
    return this.transaction(() => {
      this.db
        .prepare("DELETE FROM rate_windows WHERE window<?")
        .run(window - 1);
      const current = this.db
        .prepare("SELECT window,count FROM rate_windows WHERE bucket=?")
        .get(bucket) as { window: number; count: number } | undefined;
      if (current?.window === window && current.count >= limit) return false;
      this.db
        .prepare(
          "INSERT INTO rate_windows(bucket,window,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN rate_windows.window=excluded.window THEN rate_windows.count+1 ELSE 1 END,window=excluded.window",
        )
        .run(bucket, window);
      return true;
    });
  }
  acquireLease(
    room: string,
    actor: string,
    lease: string,
    capacity: number,
    now = Date.now(),
  ) {
    return this.transaction(() => {
      this.db.prepare("DELETE FROM leases WHERE expires<=?").run(now);
      const existing = this.db
        .prepare("SELECT lease FROM leases WHERE room=? AND actor=?")
        .get(room, actor.toLowerCase());
      const count = (
        this.db
          .prepare("SELECT COUNT(*) AS count FROM leases WHERE room=?")
          .get(room) as { count: number }
      ).count;
      if (!existing && count >= capacity) return false;
      this.db
        .prepare(
          "INSERT INTO leases(room,actor,lease,expires) VALUES(?,?,?,?) ON CONFLICT(room,actor) DO UPDATE SET lease=excluded.lease,expires=excluded.expires",
        )
        .run(room, actor.toLowerCase(), lease, now + 45000);
      return true;
    });
  }
  releaseLease(room: string, actor: string, lease: string) {
    this.db
      .prepare("DELETE FROM leases WHERE room=? AND actor=? AND lease=?")
      .run(room, actor.toLowerCase(), lease);
  }
  hasLease(room: string, actor: string, now = Date.now()) {
    return !!this.db
      .prepare("SELECT 1 FROM leases WHERE room=? AND actor=? AND expires>?")
      .get(room, actor.toLowerCase(), now);
  }
  leaseCount(room: string, now = Date.now()) {
    return (
      this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM leases WHERE room=? AND expires>?",
        )
        .get(room, now) as { count: number }
    ).count;
  }
  balance(wallet: string) {
    return Number(
      (
        this.db
          .prepare("SELECT amount FROM credits WHERE wallet=?")
          .get(wallet.toLowerCase()) as { amount: number } | undefined
      )?.amount || 0,
    );
  }
}
const globals = globalThis as typeof globalThis & {
  mycelicPaymentStore?: PaymentStore;
};
export const paymentStore = () =>
  (globals.mycelicPaymentStore ??= new PaymentStore());
