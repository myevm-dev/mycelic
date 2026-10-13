import { HttpError } from "@/payments/service";
export async function readJson(
  request: Request,
  maxBytes = 100000,
): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
    throw new HttpError(413, "Request too large");
  if (!request.body) throw new HttpError(400, "JSON body required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new HttpError(408, "Request body timed out"));
      void reader.cancel().catch(() => {});
    }, 15000);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), expired]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413, "Request too large");
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timeout!);
    reader.releaseLock();
  }
  const payload = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(payload),
    );
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}
/** Bounds concurrent request work. Edge request/rate controls are still needed against distributed floods. */
export class RequestGate {
  private active = 0;
  constructor(private limit = 32) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit)
      throw new HttpError(
        503,
        "Service is busy; retry the same operation shortly",
        "service_busy",
      );
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
    }
  }
}
const globals = globalThis as typeof globalThis & {
  mycelicRequestGate?: RequestGate;
};
export const requestGate = () =>
  (globals.mycelicRequestGate ??= new RequestGate());
export const errorResponse = (error: unknown) =>
  Response.json(
    {
      error: error instanceof Error ? error.message : "Request failed",
      ...(error instanceof HttpError
        ? { code: error.code, ...error.details }
        : {}),
    },
    {
      status: error instanceof HttpError ? error.status : 400,
      headers: {
        "Cache-Control": "no-store",
        ...(error instanceof HttpError && [429, 503].includes(error.status)
          ? { "Retry-After": "5" }
          : {}),
      },
    },
  );
