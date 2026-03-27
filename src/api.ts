import { resolveWeworkBaseUrl } from "./accounts.js";
import { enqueueWeworkEnvelope, waitForWeworkResponse } from "./bridge.js";

export type WeworkFetch = typeof fetch;

export type WeworkEnvelope = {
  type: number | string;
  data?: unknown;
};

export type WeworkPostResponse = {
  success?: boolean;
  error?: string;
  raw?: unknown;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function buildBaseUrl(raw?: string): string {
  return resolveWeworkBaseUrl({ baseUrl: raw });
}

async function postJson(
  url: string,
  payload: unknown,
  fetcher?: WeworkFetch,
  timeoutMs?: number,
): Promise<WeworkPostResponse> {
  const effectiveFetch = fetcher ?? fetch;
  const controller = new AbortController();
  const signal = controller.signal;
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await effectiveFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { success: false, error: text || `HTTP ${res.status}` };
    }
    if (!text.trim()) return { success: true };
    try {
      const parsed = JSON.parse(text) as WeworkPostResponse;
      if (typeof parsed === "object" && parsed !== null && "success" in parsed) {
        return parsed;
      }
      return { success: true, raw: parsed };
    } catch {
      return { success: true };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeWeworkEnvelope(raw: unknown): WeworkEnvelope | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "number" && typeof type !== "string") return null;
  let data = record.data;
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        data = JSON.parse(trimmed) as unknown;
      } catch {
        // leave as string
      }
    }
  }
  return { type, data };
}

export async function enqueueWeworkMessage(params: {
  accountId: string;
  envelope: WeworkEnvelope;
}): Promise<WeworkPostResponse> {
  const ok = enqueueWeworkEnvelope(params.accountId, params.envelope);
  return ok ? { success: true } : { success: false, error: "WeWork bridge not connected" };
}

export async function requestWeworkMessage(params: {
  accountId: string;
  envelope: WeworkEnvelope;
  timeoutMs?: number;
}): Promise<WeworkEnvelope | null> {
  const ok = enqueueWeworkEnvelope(params.accountId, params.envelope);
  if (!ok) return null;
  return await waitForWeworkResponse(
    params.accountId,
    params.envelope.type,
    params.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
}

export async function listWeworkContacts(params: {
  accountId: string;
  pageNum: number;
  pageSize: number;
  timeoutMs?: number;
}): Promise<Record<string, unknown> | null> {
  const response = await requestWeworkMessage({
    accountId: params.accountId,
    timeoutMs: params.timeoutMs,
    envelope: {
      type: 11037,
      data: { page_num: params.pageNum, page_size: params.pageSize },
    },
  });
  if (!response) return null;
  return response as Record<string, unknown>;
}

export async function listWeworkGroups(params: {
  accountId: string;
  pageNum: number;
  pageSize: number;
  timeoutMs?: number;
}): Promise<Record<string, unknown> | null> {
  const response = await requestWeworkMessage({
    accountId: params.accountId,
    timeoutMs: params.timeoutMs,
    envelope: {
      type: 11038,
      data: { page_num: params.pageNum, page_size: params.pageSize },
    },
  });
  if (!response) return null;
  return response as Record<string, unknown>;
}

export async function requestWeworkCdnDownload(params: {
  accountId: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  type?: number;
  baseUrl?: string;
  fetcher?: WeworkFetch;
}): Promise<WeworkPostResponse> {
  if (params.baseUrl?.trim()) {
    return await postJson(
      `${buildBaseUrl(params.baseUrl)}/message`,
      {
        type: params.type ?? 11171,
        data: params.payload,
      },
      params.fetcher,
      params.timeoutMs,
    );
  }
  return await enqueueWeworkMessage({
    accountId: params.accountId,
    envelope: {
      type: params.type ?? 11171,
      data: params.payload,
    },
  });
}
