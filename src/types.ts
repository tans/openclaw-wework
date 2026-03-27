export type WeworkAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start this WeWork account. Default: true. */
  enabled?: boolean;
  /** Base URL that OpenClaw listens on for the local HTTP bridge. Default: http://127.0.0.1:6255 */
  baseUrl?: string;
  /** Direct message access policy (default: pairing). */
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  /** Allowlist for DM senders (WeWork user IDs). */
  allowFrom?: Array<string | number>;
  /** Group access policy (default: open). */
  groupPolicy?: "open" | "allowlist" | "disabled";
  /** Group allowlist/overrides keyed by conversation id or "*". */
  groups?: Record<string, { allow?: boolean; enabled?: boolean }>;
  /** Max inbound media size in MB. */
  mediaMaxMb?: number;
  /** Optional hint for external poller delay (ms). */
  pollEmptyDelayMs?: number;
  /** Media download mode: client triggers bridge download or off. */
  mediaDownloadMode?: "client" | "off";
  /** Directory for media downloads (defaults to OS temp). */
  mediaDownloadDir?: string;
  /** Media download timeout (ms). */
  mediaDownloadTimeoutMs?: number;
};

export type WeworkConfig = {
  /** Optional per-account WeWork configuration (multi-account). */
  accounts?: Record<string, WeworkAccountConfig>;
  /** Default account ID when multiple accounts are configured. */
  defaultAccount?: string;
} & WeworkAccountConfig;

export type ResolvedWeworkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  baseUrl: string;
  config: WeworkAccountConfig;
};
