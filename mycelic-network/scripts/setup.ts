import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey } from "viem/accounts";
if (existsSync(".env.local")) {
  console.log(
    ".env.local already exists. Preserve its receipt key; see .env.example for new settings.",
  );
  process.exit(0);
}
const path = join(
  process.env.MYCELIC_DATA_DIR || ".mycelic-data",
  "receipt-key",
);
const existing =
  process.env.MYCELIC_RECEIPT_PRIVATE_KEY ||
  (existsSync(path) ? readFileSync(path, "utf8").trim() : undefined);
if (existing && !/^0x[0-9a-fA-F]{64}$/.test(existing))
  throw new Error(
    "Existing receipt key is invalid. Do not replace it without reviewing the deployment.",
  );
const template = readFileSync(".env.example", "utf8");
writeFileSync(
  ".env.local",
  template.replace(
    "MYCELIC_RECEIPT_PRIVATE_KEY=",
    "MYCELIC_RECEIPT_PRIVATE_KEY=" + (existing || generatePrivateKey()),
  ),
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Local testnet configuration created. Existing receipt key preserved when present. No treasury wallet key or Circle API key is required.",
);
