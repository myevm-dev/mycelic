import { handleRoomOperation } from "@/rooms/roomServer";
import { readJson, requestGate, errorResponse } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return await requestGate().run(async () => {
      const payment = request.headers.get("PAYMENT-SIGNATURE");
      if (payment && payment.length > 20000)
        throw new Error("Payment header too large");
      const result = await handleRoomOperation(
        await readJson(request),
        payment || undefined,
        new URL(
          "/api/rooms",
          process.env.MYCELIC_PUBLIC_URL ||
            `${new URL(request.url).protocol}//${request.headers.get("host") || new URL(request.url).host}`,
        ).toString(),
      );
      return Response.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "no-store", ...result.headers },
      });
    });
  } catch (error) {
    return errorResponse(error);
  }
}
