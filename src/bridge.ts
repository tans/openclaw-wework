import type { WeworkEnvelope } from "./api.js";

type PendingResponse = {
  resolve: (value: WeworkEnvelope | null) => void;
  timeout: NodeJS.Timeout;
};

export type WeworkBridgeState = {
  accountId: string;
  queue: WeworkEnvelope[];
  pending: Map<number | string, PendingResponse[]>;
  lastPollAt?: number;
};

const bridges = new Map<string, WeworkBridgeState>();

function normalizeTypeKey(type: WeworkEnvelope["type"]): number | string | null {
  if (typeof type === "number" && Number.isFinite(type)) return type;
  if (typeof type === "string") {
    const parsed = Number.parseInt(type, 10);
    if (Number.isFinite(parsed)) return parsed;
    const trimmed = type.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function ensureWeworkBridge(accountId: string): WeworkBridgeState {
  const existing = bridges.get(accountId);
  if (existing) return existing;
  const bridge: WeworkBridgeState = {
    accountId,
    queue: [],
    pending: new Map(),
  };
  bridges.set(accountId, bridge);
  return bridge;
}

export function removeWeworkBridge(accountId: string): void {
  const existing = bridges.get(accountId);
  if (!existing) return;
  for (const pending of existing.pending.values()) {
    for (const entry of pending) {
      clearTimeout(entry.timeout);
      entry.resolve(null);
    }
  }
  bridges.delete(accountId);
}

export function enqueueWeworkEnvelope(accountId: string, envelope: WeworkEnvelope): boolean {
  const bridge = bridges.get(accountId);
  if (!bridge) return false;
  bridge.queue.push(envelope);
  return true;
}

export function dequeueWeworkEnvelope(accountId: string): WeworkEnvelope | null {
  const bridge = bridges.get(accountId);
  if (!bridge) return null;
  bridge.lastPollAt = Date.now();
  return bridge.queue.shift() ?? null;
}

export function markWeworkPoll(accountId: string): void {
  const bridge = bridges.get(accountId);
  if (!bridge) return;
  bridge.lastPollAt = Date.now();
}

export function waitForWeworkResponse(
  accountId: string,
  type: WeworkEnvelope["type"],
  timeoutMs: number,
): Promise<WeworkEnvelope | null> {
  const bridge = bridges.get(accountId);
  if (!bridge) return Promise.resolve(null);
  const key = normalizeTypeKey(type);
  if (key == null) return Promise.resolve(null);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      const entries = bridge.pending.get(key);
      if (entries) {
        const idx = entries.findIndex((entry) => entry.resolve === resolve);
        if (idx >= 0) entries.splice(idx, 1);
        if (entries.length === 0) bridge.pending.delete(key);
      }
      resolve(null);
    }, timeoutMs);

    const entry: PendingResponse = { resolve, timeout };
    const list = bridge.pending.get(key);
    if (list) {
      list.push(entry);
    } else {
      bridge.pending.set(key, [entry]);
    }
  });
}

export function resolveWeworkResponse(
  accountId: string,
  envelope: WeworkEnvelope,
): boolean {
  const bridge = bridges.get(accountId);
  if (!bridge) return false;
  const key = normalizeTypeKey(envelope.type);
  if (key == null) return false;
  const list = bridge.pending.get(key);
  if (!list || list.length === 0) return false;
  const entry = list.shift();
  if (!entry) return false;
  if (list.length === 0) bridge.pending.delete(key);
  clearTimeout(entry.timeout);
  entry.resolve(envelope);
  return true;
}

