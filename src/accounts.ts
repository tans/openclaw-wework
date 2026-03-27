import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type { ResolvedWeworkAccount, WeworkAccountConfig, WeworkConfig } from "./types.js";

export const DEFAULT_WEWORK_BRIDGE_PORT = 6255;
export const DEFAULT_WEWORK_BASE_URL = `http://127.0.0.1:${DEFAULT_WEWORK_BRIDGE_PORT}`;

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = (cfg.channels?.wework as WeworkConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return [];
  return Object.keys(accounts).filter(Boolean);
}

export function listWeworkAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) return [DEFAULT_ACCOUNT_ID];
  return ids.sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultWeworkAccountId(cfg: OpenClawConfig): string {
  const weworkConfig = cfg.channels?.wework as WeworkConfig | undefined;
  if (weworkConfig?.defaultAccount?.trim()) return weworkConfig.defaultAccount.trim();
  const ids = listWeworkAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) return DEFAULT_ACCOUNT_ID;
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): WeworkAccountConfig | undefined {
  const accounts = (cfg.channels?.wework as WeworkConfig | undefined)?.accounts;
  if (!accounts || typeof accounts !== "object") return undefined;
  return accounts[accountId] as WeworkAccountConfig | undefined;
}

function mergeWeworkAccountConfig(cfg: OpenClawConfig, accountId: string): WeworkAccountConfig {
  const raw = (cfg.channels?.wework ?? {}) as WeworkConfig;
  const { accounts: _ignored, defaultAccount: _ignored2, ...base } = raw;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function resolveWeworkBaseUrl(config?: WeworkAccountConfig): string {
  const raw = config?.baseUrl?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return DEFAULT_WEWORK_BASE_URL;
}

export function resolveWeworkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedWeworkAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = (params.cfg.channels?.wework as WeworkConfig | undefined)?.enabled !== false;
  const merged = mergeWeworkAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const baseUrl = resolveWeworkBaseUrl(merged);

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled,
    baseUrl,
    config: merged,
  };
}

export function listEnabledWeworkAccounts(cfg: OpenClawConfig): ResolvedWeworkAccount[] {
  return listWeworkAccountIds(cfg)
    .map((accountId) => resolveWeworkAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
