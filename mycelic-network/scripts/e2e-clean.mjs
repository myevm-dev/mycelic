import { rmSync } from "node:fs";
// Reset only the fixed fixture ledger, before Playwright starts its web server.
rmSync(new URL("../.mycelic-test-data", import.meta.url), {
  recursive: true,
  force: true,
});
