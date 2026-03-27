import type { WeworkFetch } from "./api.js";

export type WeworkProbeResult = {
  ok: boolean;
  error?: string;
  elapsedMs: number;
};

export async function probeWework(
  baseUrl: string,
  timeoutMs = 2500,
  fetcher?: WeworkFetch,
): Promise<WeworkProbeResult> {
  const startTime = Date.now();
  const url = `${baseUrl.replace(/\/$/, "")}/message`;
  const effectiveFetch = fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await effectiveFetch(url, { method: "GET", signal: controller.signal });
    const elapsedMs = Date.now() - startTime;
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, elapsedMs };
    return { ok: true, elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: `Request timed out after ${timeoutMs}ms`, elapsedMs };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err), elapsedMs };
  } finally {
    clearTimeout(timeout);
  }
}
