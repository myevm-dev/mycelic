import { publicPaymentConfig } from "@/payments/config";
import { paymentStore } from "@/payments/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const config = publicPaymentConfig();
    const store = paymentStore();
    store.pinPolicy(config.policy);
    store.db.prepare("SELECT 1").get();
    return Response.json(
      {
        status: config.enabled ? "ready" : "payments_disabled",
        environment: config.policy.environment,
        version: "0.6.1",
      },
      {
        status: config.enabled ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error(
      "Mycelic configuration check failed:",
      error instanceof Error ? error.message : "Unknown configuration error",
    );
    return Response.json(
      {
        status: "not_ready",
        error:
          "Check receipt key, ledger identity and persistent storage configuration.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
