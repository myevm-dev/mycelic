import { CircleGatewayProvider } from "../src/payments/gateway";
import {
  publicPaymentConfig,
  gatewayUrl,
} from "../src/payments/config";

const config = publicPaymentConfig();

if (!config.enabled) {
  throw new Error(config.reason || "Payments are disabled");
}

const isMainnet = config.policy.environment === "mainnet";
const expectedNetwork = isMainnet
  ? "eip155:5042"
  : "eip155:5042002";

const treasury = config.policy.treasury;
const provider = new CircleGatewayProvider();
const requirements = await provider.requirements("3000000");

const arcRequirement = requirements.find(
  (requirement) =>
    requirement.network === expectedNetwork &&
    requirement.payTo.toLowerCase() === treasury.toLowerCase() &&
    requirement.amount === "3000000",
);

if (!arcRequirement) {
  throw new Error(
    `Arc ${config.policy.environment} Gateway requirements mismatch. ` +
      `Expected ${expectedNetwork}, 3 USDC, and treasury ${treasury}.`,
  );
}

// Read-only search probe. This does not submit a payment.
const record = await provider.reconcile(`0x${"00".repeat(32)}`);

console.log(
  JSON.stringify(
    {
      gateway: `live ${config.policy.environment}`,
      gatewayApi: gatewayUrl(),
      treasury,
      expectedNetwork,
      arcSupported: true,
      supportedNetworks: requirements.map(
        (requirement) => requirement.network,
      ),
      searchApiWorking: true,
      zeroNonceHasRecord: !!record,
      paymentsMade: 0,
    },
    null,
    2,
  ),
);