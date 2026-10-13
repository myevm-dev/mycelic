import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonical } from "../src/types/protocol";
import { publicPaymentConfig } from "../src/payments/config";
import { createFirestoreStore } from "../src/payments/firestoreStore";
import {
  type LedgerCollection,
  type LedgerRecords,
  type LedgerTransaction,
  postKey,
} from "../src/payments/ledger";

// Offline, resumable import. Never talks to Gateway or transfers funds.
const source = process.argv[2];
if (!source || !process.argv.includes("--writers-stopped"))
  throw new Error(
    "Stop all old and new API writers, then pass a SQLite snapshot path and --writers-stopped. See docs/firestore.md.",
  );
const fingerprint = createHash("sha256")
  .update(readFileSync(source))
  .digest("hex");
const policy = publicPaymentConfig().policy;
const db = new DatabaseSync(source, { readOnly: true });
const store = createFirestoreStore();
const collections: LedgerCollection[] = [
  "rooms",
  "credits",
  "posts",
  "intents",
  "creation_claims",
  "nonces",
];
try {
  if (
    (db.prepare("PRAGMA quick_check").get() as { quick_check: string })
      .quick_check !== "ok"
  )
    throw new Error("Source SQLite integrity check failed");
  const pinned = db
    .prepare("SELECT value FROM settings WHERE name='payment-policy'")
    .get() as { value: string } | undefined;
  if (pinned?.value !== canonical(policy))
    throw new Error(
      "Source policy must match configured environment, issuer, treasury and service ID exactly",
    );
  const rooms = db
    .prepare("SELECT * FROM rooms")
    .all() as LedgerRecords["rooms"][];
  if (
    rooms.some(
      (row) =>
        canonical(JSON.parse(row.definition).payment) !== canonical(policy),
    )
  )
    throw new Error("Source room payment identity mismatch");
  const credits = db
    .prepare("SELECT * FROM credits")
    .all() as LedgerRecords["credits"][];
  if (
    credits.some((row) => !Number.isSafeInteger(row.amount) || row.amount < 0)
  )
    throw new Error("Source credit balance is invalid");
  const intents = db
    .prepare("SELECT * FROM intents")
    .all() as LedgerRecords["intents"][];
  const groups: {
    collection: LedgerCollection;
    rows: unknown[];
    key: (row: Record<string, string>) => string;
  }[] = [
    { collection: "rooms", rows: rooms, key: (r) => r.hash },
    { collection: "credits", rows: credits, key: (r) => r.wallet },
    {
      collection: "posts",
      rows: db.prepare("SELECT * FROM posts").all(),
      key: (r) => postKey(r.room, r.id),
    },
    { collection: "intents", rows: intents, key: (r) => r.id },
    {
      collection: "creation_claims",
      rows: db.prepare("SELECT * FROM creation_claims").all(),
      key: (r) => r.room,
    },
    {
      collection: "nonces",
      rows: intents
        .filter((r) => r.nonce)
        .map((r) => ({ nonce: r.nonce!.toLowerCase(), intent: r.id })),
      key: (r) => r.nonce,
    },
  ];
  const existingMigration = await store.get("settings", "sqlite-import");
  if (!existingMigration) {
    for (const collection of collections)
      if ((await store.list(collection)).length)
        throw new Error(
          "Target ledger must be empty. Import never overwrites a used ledger.",
        );
  }
  await store.transaction(async (tx) => {
    const migration = await tx.get("settings", "sqlite-import");
    const targetPolicy = await tx.get("settings", "payment-policy");
    if (targetPolicy && targetPolicy.value !== canonical(policy))
      throw new Error("Target policy mismatch");
    if (migration) {
      const state = JSON.parse(migration.value);
      if (state.fingerprint !== fingerprint)
        throw new Error("Resume only with the exact same SQLite snapshot");
      if (state.status === "completed")
        throw new Error(
          "This snapshot was already imported. No records changed.",
        );
    }
    tx.set("settings", "payment-policy", {
      name: "payment-policy",
      value: canonical(policy),
    });
    tx.set("settings", "sqlite-import", {
      name: "sqlite-import",
      value: JSON.stringify({ fingerprint, status: "pending" }),
    });
  });
  const counts: Record<string, number> = {};
  for (const { collection, rows, key } of groups) {
    for (let offset = 0; offset < rows.length; offset += 200) {
      await store.transaction(async (tx) => {
        const batch = rows.slice(offset, offset + 200) as Record<
          string,
          string
        >[];
        // Check all existing documents before staging writes. A resume must be identical.
        for (const row of batch) {
          const existing = await tx.get(collection, key(row));
          if (existing && canonical(existing) !== canonical(row))
            throw new Error(
              "Target changed during import. Leave writers stopped and investigate.",
            );
        }
        for (const row of batch)
          tx.set(
            collection,
            key(row),
            row as unknown as Parameters<LedgerTransaction["set"]>[2],
          );
      });
    }
    counts[collection] = rows.length;
  }
  await store.transaction(async (tx) => {
    const state = await tx.get("settings", "sqlite-import");
    if (!state || JSON.parse(state.value).fingerprint !== fingerprint)
      throw new Error("Import state changed");
    tx.set("settings", "sqlite-import", {
      name: "sqlite-import",
      value: JSON.stringify({ fingerprint, status: "completed", counts }),
    });
  });
  console.log(
    JSON.stringify(
      {
        imported: true,
        environment: policy.environment,
        namespace: store.namespace,
        counts,
        paymentsMade: 0,
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
  await store.close();
}
