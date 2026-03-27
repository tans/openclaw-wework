import path from "node:path";
import type {
  ChannelAccountSnapshot,
  ChannelDock,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import {
  applyAccountNameToChannelSection,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";
import { waitForAbortSignal } from "openclaw/plugin-sdk/runtime-env";
import {
  listWeworkAccountIds,
  resolveDefaultWeworkAccountId,
  resolveWeworkAccount,
} from "./accounts.js";
import { weworkMessageActions } from "./actions.js";
import { listWeworkContacts, listWeworkGroups } from "./api.js";
import { weworkConfigSchema } from "./config-schema.js";
import { monitorWeworkProvider } from "./monitor.js";
import { weworkOnboardingAdapter } from "./onboarding.js";
import { probeWework } from "./probe.js";
import { sendFileWework, sendImageWework, sendTextWework } from "./send.js";
import { collectWeworkStatusIssues } from "./status-issues.js";
import type { ResolvedWeworkAccount } from "./types.js";

const meta = {
  id: "wework",
  label: "WeWork",
  selectionLabel: "WeWork (HTTP bridge)",
  docsPath: "/channels/wework",
  docsLabel: "wework",
  blurb: "Enterprise WeChat via local HTTP bridge.",
  aliases: ["wecom", "qywx", "ww"],
  order: 85,
  quickstartAllowFrom: true,
};

function normalizeWeworkMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(wework|wecom|qywx|ww):/i, "");
}

function isImagePath(raw: string): boolean {
  const ext = path.extname(raw).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext);
}

export const weworkDock: ChannelDock = {
  id: "wework",
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 2000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveWeworkAccount({ cfg: cfg as OpenClawConfig, accountId }).config
          .allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(wework|wecom|qywx|ww):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  groups: {
    resolveRequireMention: () => false,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const weworkPlugin: ChannelPlugin<ResolvedWeworkAccount> = {
  id: "wework",
  meta,
  onboarding: weworkOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.wework"] },
  configSchema: weworkConfigSchema,
  config: {
    listAccountIds: (cfg) => listWeworkAccountIds(cfg as OpenClawConfig),
    resolveAccount: (cfg, accountId) =>
      resolveWeworkAccount({ cfg: cfg as OpenClawConfig, accountId }),
    defaultAccountId: (cfg) =>
      resolveDefaultWeworkAccountId(cfg as OpenClawConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "wework",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "wework",
        accountId,
        clearBaseFields: ["baseUrl", "name"],
      }),
    isConfigured: (account) => Boolean(account.baseUrl?.trim()),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.baseUrl?.trim()),
      baseUrl: account.baseUrl,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (
        resolveWeworkAccount({ cfg: cfg as OpenClawConfig, accountId }).config
          .allowFrom ?? []
      ).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(wework|wecom|qywx|ww):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId =
        accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg as OpenClawConfig).channels?.wework?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.wework.accounts.${resolvedAccountId}.`
        : "channels.wework.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("wework"),
        normalizeEntry: (raw) => raw.replace(/^(wework|wecom|qywx|ww):/i, ""),
      };
    },
  },
  groups: {
    resolveRequireMention: () => false,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  actions: weworkMessageActions,
  messaging: {
    normalizeTarget: normalizeWeworkMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        return Boolean(trimmed);
      },
      hint: "<conversationId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveWeworkAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      const q = query?.trim().toLowerCase() || "";
      const response = await listWeworkContacts({
        accountId: account.accountId,
        pageNum: 1,
        pageSize: limit && limit > 0 ? limit : 50,
      });
      if (!response) return [];
      const payload =
        (response as { raw?: unknown; data?: unknown })?.raw ?? response;
      const data = (payload as { data?: unknown })?.data as
        | { user_list?: Array<{ conversation_id?: string; username?: string }> }
        | undefined;
      const peers = (data?.user_list ?? [])
        .map((entry) => ({
          id: entry.conversation_id ?? "",
          name: entry.username ?? "",
        }))
        .filter((entry) => entry.id)
        .filter((entry) =>
          q
            ? entry.id.toLowerCase().includes(q) ||
              entry.name.toLowerCase().includes(q)
            : true,
        )
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map(
          (entry) =>
            ({ kind: "user", id: entry.id, name: entry.name }) as const,
        );
      return peers;
    },
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveWeworkAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      const q = query?.trim().toLowerCase() || "";
      const response = await listWeworkGroups({
        accountId: account.accountId,
        pageNum: 1,
        pageSize: limit && limit > 0 ? limit : 50,
      });
      if (!response) return [];
      const payload =
        (response as { raw?: unknown; data?: unknown })?.raw ?? response;
      const data = (payload as { data?: unknown })?.data as
        | { room_list?: Array<{ conversation_id?: string; nickname?: string }> }
        | undefined;
      const groups = (data?.room_list ?? [])
        .map((entry) => ({
          id: entry.conversation_id ?? "",
          name: entry.nickname ?? "",
        }))
        .filter((entry) => entry.id)
        .filter((entry) =>
          q
            ? entry.id.toLowerCase().includes(q) ||
              entry.name.toLowerCase().includes(q)
            : true,
        )
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map(
          (entry) =>
            ({ kind: "group", id: entry.id, name: entry.name }) as const,
        );
      return groups;
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as OpenClawConfig,
        channelKey: "wework",
        accountId,
        name,
      }),
    validateInput: ({ input }) => {
      if (!input.baseUrl) return null;
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as OpenClawConfig,
        channelKey: "wework",
        accountId,
        name: input.name,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig,
              channelKey: "wework",
            })
          : namedConfig;
      const existing = resolveWeworkAccount({
        cfg: next as OpenClawConfig,
        accountId,
      });
      const baseUrl = input.baseUrl?.trim() || existing.baseUrl;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            wework: {
              ...next.channels?.wework,
              enabled: true,
              baseUrl,
            },
          },
        } as OpenClawConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          wework: {
            ...next.channels?.wework,
            enabled: true,
            accounts: {
              ...(next.channels?.wework?.accounts ?? {}),
              [accountId]: {
                ...(next.channels?.wework?.accounts?.[accountId] ?? {}),
                enabled: true,
                baseUrl,
              },
            },
          },
        },
      } as OpenClawConfig;
    },
  },
  pairing: {
    idLabel: "weworkUserId",
    normalizeAllowEntry: (entry) =>
      entry.replace(/^(wework|wecom|qywx|ww):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveWeworkAccount({ cfg: cfg as OpenClawConfig });
      await sendTextWework(id, PAIRING_APPROVED_MESSAGE, {
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      if (!text) return [];
      if (limit <= 0 || text.length <= limit) return [text];
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > limit) {
        const window = remaining.slice(0, limit);
        const lastNewline = window.lastIndexOf("\n");
        const lastSpace = window.lastIndexOf(" ");
        let breakIdx = lastNewline > 0 ? lastNewline : lastSpace;
        if (breakIdx <= 0) breakIdx = limit;
        const rawChunk = remaining.slice(0, breakIdx);
        const chunk = rawChunk.trimEnd();
        if (chunk.length > 0) chunks.push(chunk);
        const brokeOnSeparator =
          breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
        const nextStart = Math.min(
          remaining.length,
          breakIdx + (brokeOnSeparator ? 1 : 0),
        );
        remaining = remaining.slice(nextStart).trimStart();
      }
      if (remaining.length) chunks.push(remaining);
      return chunks;
    },
    chunkerMode: "text",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId, cfg }) => {
      const account = resolveWeworkAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      const result = await sendTextWework(to, text, {
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
      return {
        channel: "wework",
        ok: result.ok,
        messageId: "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg }) => {
      const account = resolveWeworkAccount({
        cfg: cfg as OpenClawConfig,
        accountId,
      });
      if (!mediaUrl) {
        return {
          channel: "wework",
          ok: false,
          messageId: "",
          error: new Error("mediaUrl required"),
        };
      }
      const mediaResult = isImagePath(mediaUrl)
        ? await sendImageWework(to, mediaUrl, {
            cfg: cfg as OpenClawConfig,
            accountId: account.accountId,
          })
        : await sendFileWework(to, mediaUrl, {
            cfg: cfg as OpenClawConfig,
            accountId: account.accountId,
          });
      if (!mediaResult.ok) {
        return {
          channel: "wework",
          ok: false,
          messageId: "",
          error: new Error(mediaResult.error ?? "failed to send media"),
        };
      }
      if (text) {
        await sendTextWework(to, text, {
          cfg: cfg as OpenClawConfig,
          accountId: account.accountId,
        });
      }
      return {
        channel: "wework",
        ok: true,
        messageId: "",
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) => collectWeworkStatusIssues(accounts),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      mode: snapshot.mode ?? "webhook",
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) =>
      probeWework(account.baseUrl, timeoutMs),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.baseUrl?.trim()),
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      mode: "webhook",
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      dmPolicy: account.config.dmPolicy ?? "pairing",
      groupPolicy: account.config.groupPolicy ?? "open",
      baseUrl: account.baseUrl,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting wework provider`);
      const { stop } = await monitorWeworkProvider({
        account,
        config: ctx.cfg as OpenClawConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) =>
          ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });
      await waitForAbortSignal(ctx.abortSignal);
      await stop();
    },
  },
};
