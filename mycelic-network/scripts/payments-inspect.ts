import { paymentStore } from "../src/payments/store";
import { PaymentService, type IntentRow } from "../src/payments/service";
import { publicPaymentConfig, receiptSigner } from "../src/payments/config";
import { CircleGatewayProvider } from "../src/payments/gateway";
const store = paymentStore();
const config = publicPaymentConfig();
store.pinPolicy(config.policy);
const rows = store.db
  .prepare(
    "SELECT * FROM intents WHERE status IN ('pending','failed') ORDER BY expires",
  )
  .all() as IntentRow[];
if (process.argv.includes("--reconcile")) {
  const service = new PaymentService(
    store,
    config.policy,
    receiptSigner(),
    new CircleGatewayProvider(),
  );
  for (const row of rows) {
    try {
      await service.purchase({
        id: row.id,
        wallet: row.owner,
        kind: row.kind,
        data: JSON.parse(row.data),
        amount: row.amount,
        url: "https://operator.invalid/api/rooms",
      });
      console.log(JSON.stringify({ intent: row.id, reconciled: true }));
    } catch (error) {
      console.log(
        JSON.stringify({
          intent: row.id,
          error: error instanceof Error ? error.message : "Failed",
        }),
      );
    }
  }
}
console.log(
  JSON.stringify(
    {
      environment: config.policy.environment,
      treasury: config.policy.treasury,
      credits: store.db.prepare("SELECT wallet,amount FROM credits").all(),
      intents: store.db
        .prepare(
          "SELECT id,owner,kind,amount,status,nonce,error FROM intents ORDER BY expires DESC LIMIT 100",
        )
        .all(),
    },
    null,
    2,
  ),
);
store.db.close();
