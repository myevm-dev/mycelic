import { publicPaymentConfig } from "@/payments/config";
import { paymentStore } from "@/payments/store";
export const runtime = "nodejs";
export async function GET() {
  try {
    const config = publicPaymentConfig();
    await (await paymentStore()).pinPolicy(config.policy);
    return Response.json(config, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(
      "Mycelic configuration check failed:",
      error instanceof Error ? error.message : "Unknown configuration error",
    );
    return Response.json(
      { error: "Payment service needs configuration. See deployment setup." },
      { status: 503 },
    );
  }
}
