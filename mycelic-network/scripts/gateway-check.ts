import { CircleGatewayProvider } from "../src/payments/gateway";
import { TREASURY } from "../src/payments/shared";
const provider = new CircleGatewayProvider();
const requirements = await provider.requirements("3000000");
if (
  !requirements.some(
    (r) => r.network === "eip155:5042002" && r.payTo.toLowerCase() === TREASURY,
  )
)
  throw new Error("Arc testnet Gateway requirements mismatch");
const record = await provider.reconcile(`0x${"00".repeat(32)}`);
console.log(
  JSON.stringify(
    {
      gateway: "live testnet",
      treasury: TREASURY,
      supportedNetworks: requirements.map((r) => r.network),
      searchApiWorking: true,
      zeroNonceHasRecord: !!record,
      paymentsMade: 0,
    },
    null,
    2,
  ),
);
