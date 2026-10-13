import { backup } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { paymentStore } from "../src/payments/store";
import { publicPaymentConfig, receiptPrivateKey } from "../src/payments/config";
const config = publicPaymentConfig();
const store = paymentStore();
store.pinPolicy(config.policy);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = resolve(process.argv[2] || join(".mycelic-backups", stamp));
mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
mkdirSync(target, { recursive: false, mode: 0o700 });
try {
  await backup(store.db, join(target, "ledger.sqlite"));
  writeFileSync(join(target, "receipt-key"), receiptPrivateKey(), {
    mode: 0o600,
    flag: "wx",
  });
  writeFileSync(
    join(target, "identity.json"),
    JSON.stringify(
      {
        policy: config.policy,
        createdAt: new Date().toISOString(),
        publicUrl: process.env.MYCELIC_PUBLIC_URL,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    JSON.stringify({
      backup: target,
      environment: config.policy.environment,
      complete: true,
      containsPrivateReceiptKey: true,
    }),
  );
} finally {
  store.db.close();
}
