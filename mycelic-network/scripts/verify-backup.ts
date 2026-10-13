import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex } from "viem";
import { canonical, paymentPolicySchema } from "../src/types/protocol";
const path = process.argv[2];
if (!path) throw new Error("Pass the private backup directory path");
const directory = resolve(path);
const identity = JSON.parse(
  readFileSync(join(directory, "identity.json"), "utf8"),
);
const policy = paymentPolicySchema.parse(identity.policy);
const key = readFileSync(join(directory, "receipt-key"), "utf8").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key))
  throw new Error("Invalid backup receipt key");
if (privateKeyToAccount(key as Hex).address !== policy.issuer)
  throw new Error("Backup receipt key does not match the recorded issuer");
const db = new DatabaseSync(join(directory, "ledger.sqlite"), {
  readOnly: true,
});
try {
  const check = db.prepare("PRAGMA quick_check").get() as {
    quick_check: string;
  };
  if (check.quick_check !== "ok")
    throw new Error("Backup database integrity check failed");
  const stored = db
    .prepare("SELECT value FROM settings WHERE name='payment-policy'")
    .get() as { value: string };
  if (stored.value !== canonical(policy))
    throw new Error("Backup ledger identity mismatch");
  console.log(
    JSON.stringify({
      verified: true,
      environment: policy.environment,
      issuer: policy.issuer,
    }),
  );
} finally {
  db.close();
}
