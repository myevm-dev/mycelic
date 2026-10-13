import { paymentStore } from "../src/payments/store";
import { PaymentService } from "../src/payments/service";
import { publicPaymentConfig, receiptSigner } from "../src/payments/config";
import { CircleGatewayProvider } from "../src/payments/gateway";
const store = await paymentStore();
const config = publicPaymentConfig();
await store.pinPolicy(config.policy);
const rows = (await store.list("intents"))
  .filter((row) => ["pending", "failed"].includes(row.status))
  .sort((a, b) => a.expires - b.expires);
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
      credits: await store.list("credits"),
      intents: (await store.list("intents"))
        .sort((a, b) => b.expires - a.expires)
        .slice(0, 100)
        .map(({ id, owner, kind, amount, status, nonce, error }) => ({
          id,
          owner,
          kind,
          amount,
          status,
          nonce,
          error,
        })),
    },
    null,
    2,
  ),
);
await store.close();
