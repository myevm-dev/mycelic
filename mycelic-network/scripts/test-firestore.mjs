import { spawnSync } from "node:child_process";
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
  console.error(
    "Start a local Firestore emulator, then set FIRESTORE_EMULATOR_HOST=127.0.0.1:8181. See docs/firestore.md.",
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "tests/firestore.test.ts"],
  { stdio: "inherit", env: { ...process.env, MYCELIC_PAYMENT_ENV: "testnet" } },
);
process.exit(result.status ?? 1);
