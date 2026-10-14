import { createHash } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type Firestore,
  type DocumentReference,
} from "firebase-admin/firestore";
import {
  PaymentLedger,
  type LedgerCollection,
  type LedgerRecords,
  type LedgerTransaction,
} from "./ledger";

/** Firestore transaction callbacks can retry. No Gateway calls or signatures belong here. */
export class FirestorePaymentStore extends PaymentLedger {
  readonly backend = "firestore" as const;
  constructor(
    readonly db: Firestore,
    readonly namespace: string,
  ) {
    super();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(namespace))
      throw new Error("Invalid Firestore ledger namespace");
  }
  private collection(name: LedgerCollection) {
    return this.db
      .collection("mycelic_ledgers")
      .doc(this.namespace)
      .collection(name);
  }
  private ref(name: LedgerCollection, key: string) {
    return this.collection(name).doc(
      createHash("sha256").update(key).digest("hex"),
    );
  }
  async get<C extends LedgerCollection>(
    collection: C,
    key: string,
  ): Promise<LedgerRecords[C] | undefined> {
    return (await this.ref(collection, key).get()).data() as
      LedgerRecords[C] | undefined;
  }
  async list<C extends LedgerCollection>(
    collection: C,
  ): Promise<LedgerRecords[C][]> {
    return (await this.collection(collection).get()).docs.map(
      (doc) => doc.data() as LedgerRecords[C],
    );
  }
  async transaction<T>(fn: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    return this.db.runTransaction(
      async (native) => {
        // Buffer writes so all native reads precede writes, including logical reads of staged values.
        const staged = new Map<
          string,
          { ref: DocumentReference; value: unknown | null }
        >();
        const cached = new Map<string, unknown>();
        const result = await fn({
          get: async <C extends LedgerCollection>(
            collection: C,
            key: string,
          ) => {
            const ref = this.ref(collection, key);
            if (staged.has(ref.path))
              return structuredClone(
                staged.get(ref.path)!.value || undefined,
              ) as LedgerRecords[C] | undefined;
            if (!cached.has(ref.path))
              cached.set(ref.path, (await native.get(ref)).data());
            return structuredClone(cached.get(ref.path)) as
              LedgerRecords[C] | undefined;
          },
          set: (collection, key, record) => {
            const ref = this.ref(collection, key);
            staged.set(ref.path, { ref, value: structuredClone(record) });
          },
          delete: (collection, key) => {
            const ref = this.ref(collection, key);
            staged.set(ref.path, { ref, value: null });
          },
        });
        for (const { ref, value } of staged.values()) {
          if (value === null) native.delete(ref);
          else native.set(ref, value as Record<string, unknown>);
        }
        return result;
      },
      { maxAttempts: 10 },
    );
  }
  async close() {
    await this.db.terminate();
  }
}
export function createFirestoreStore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId)
    throw new Error("Configure FIREBASE_PROJECT_ID for Firestore payments");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (
    emulator &&
    (process.env.VERCEL || process.env.MYCELIC_PAYMENT_ENV === "mainnet")
  )
    throw new Error(
      "Firestore emulator must not be used for hosted or mainnet payments",
    );
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!emulator && (!clientEmail || !privateKey))
    throw new Error(
      "Configure server-only FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY",
    );
  const appName = `mycelic-${projectId}`;
  const app =
    getApps().find((app) => app.name === appName) ||
    initializeApp(
      {
        projectId,
        ...(emulator
          ? {}
          : { credential: cert({ projectId, clientEmail, privateKey }) }),
      },
      appName,
    );
  const db = getFirestore(
    app,
    process.env.MYCELIC_FIRESTORE_DATABASE_ID || "(default)",
  );
  const environment =
    process.env.MYCELIC_PAYMENT_ENV === "mainnet" ? "mainnet" : "testnet";
  const prefix = process.env.MYCELIC_FIRESTORE_NAMESPACE || "mycelic";
  return new FirestorePaymentStore(db, `${prefix}-${environment}`);
}
