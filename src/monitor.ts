import crypto from "node:crypto";
import fs from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  createReplyPrefixOptions,
  type MarkdownTableMode,
  type OpenClawConfig,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { DEFAULT_WEWORK_BRIDGE_PORT } from "./accounts.js";
import { normalizeWeworkEnvelope, requestWeworkCdnDownload, type WeworkEnvelope } from "./api.js";
import {
  dequeueWeworkEnvelope,
  ensureWeworkBridge,
  markWeworkPoll,
  removeWeworkBridge,
  resolveWeworkResponse,
} from "./bridge.js";
import { getWeworkRuntime } from "./runtime.js";
import { sendFileWework, sendImageWework, sendTextWework } from "./send.js";
import type { ResolvedWeworkAccount } from "./types.js";

export type WeworkMonitorOptions = {
  account: ResolvedWeworkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type WeworkMonitorResult = {
  stop: () => Promise<void>;
};

const DEFAULT_MEDIA_MAX_MB = 5;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 10_000;

const MESSAGE_TYPES = {
  SEND_TEXT: 11029,
  SEND_IMAGE: 11030,
  SEND_FILE: 11031,
  SEND_AT_TEXT: 11069,
  MSG_TEXT: 11041,
  MSG_IMAGE: 11042,
  MSG_LINK: 11047,
  EVENT_LOGIN: 11026,
  LOGOUT: 11112,
  GET_QRCODE: 11122,
  CDN_DOWNLOAD_11171: 11171,
  CDN_DOWNLOAD_11170: 11170,
} as const;

type WeworkIncomingText = {
  content?: string;
  content_type?: number;
  conversation_id?: string;
  sender?: string;
  sender_name?: string;
  receiver?: string;
  send_time?: string | number;
  local_id?: string;
  server_id?: string;
  at_list?: string[];
};

type WeworkIncomingImage = WeworkIncomingText & {
  cdn_type?: number;
  cdn?: {
    aes_key?: string;
    auth_key?: string;
    file_id?: string;
    file_size?: number;
    file_type?: number;
    md5?: string;
    size?: number;
    url?: string;
    md_url?: string;
    ld_url?: string;
  };
};

type WeworkIncomingLink = WeworkIncomingText & {
  title?: string;
  desc?: string;
  url?: string;
};

type WeworkCoreRuntime = ReturnType<typeof getWeworkRuntime>;

function logVerbose(core: WeworkCoreRuntime, runtime: RuntimeEnv, message: string): void {
  if (core.logging.shouldLogVerbose()) {
    runtime.log?.(`[wework] ${message}`);
  }
}

function normalizeAllowEntry(entry: string): string {
  return entry
    .replace(/^(wework|ww|wecom|qywx):/i, "")
    .trim()
    .toLowerCase();
}

function isSenderAllowed(senderId: string, allowFrom: string[]): boolean {
  if (allowFrom.includes("*")) return true;
  const normalizedSenderId = senderId.toLowerCase();
  return allowFrom.some((entry) => normalizeAllowEntry(entry) === normalizedSenderId);
}

function isGroupConversation(conversationId: string): boolean {
  return conversationId.startsWith("R:");
}

function resolveMediaMaxMb(account: ResolvedWeworkAccount): number {
  const configured = account.config.mediaMaxMb;
  if (typeof configured === "number" && Number.isFinite(configured)) return configured;
  return DEFAULT_MEDIA_MAX_MB;
}

function resolveDownloadDir(account: ResolvedWeworkAccount): string {
  const configured = account.config.mediaDownloadDir?.trim();
  if (configured) return configured;
  return os.tmpdir();
}

function resolveDownloadTimeout(account: ResolvedWeworkAccount): number {
  const configured = account.config.mediaDownloadTimeoutMs;
  if (typeof configured === "number" && Number.isFinite(configured)) return configured;
  return DEFAULT_DOWNLOAD_TIMEOUT_MS;
}

function resolveMessagePath(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const basePath = url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : "";
    return `${basePath}/message`;
  } catch {
    try {
      const url = new URL(`http://${baseUrl}`);
      const basePath = url.pathname && url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : "";
      return `${basePath}/message`;
    } catch {
      return "/message";
    }
  }
}

function resolveListenConfig(account: ResolvedWeworkAccount): {
  host: string;
  port: number;
  messagePath: string;
} {
  const parse = (value: string): URL | null => {
    try {
      return new URL(value);
    } catch {
      try {
        return new URL(`http://${value}`);
      } catch {
        return null;
      }
    }
  };

  const url = parse(account.baseUrl);
  if (!url) {
    return {
      host: "127.0.0.1",
      port: DEFAULT_WEWORK_BRIDGE_PORT,
      messagePath: "/message",
    };
  }

  const host = url.hostname || "127.0.0.1";
  const explicitPort = url.port ? Number.parseInt(url.port, 10) : Number.NaN;
  const port = Number.isFinite(explicitPort) ? explicitPort : DEFAULT_WEWORK_BRIDGE_PORT;
  return { host, port, messagePath: resolveMessagePath(account.baseUrl) };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function isGroupAllowed(params: {
  groupId: string;
  groups: Record<string, { allow?: boolean; enabled?: boolean }>;
}): boolean {
  const { groupId, groups } = params;
  const keys = Object.keys(groups ?? {});
  if (keys.length === 0) return false;
  const candidates = [groupId, `group:${groupId}`];
  for (const candidate of candidates) {
    const entry = groups[candidate];
    if (!entry) continue;
    return entry.allow !== false && entry.enabled !== false;
  }
  const wildcard = groups["*"];
  if (wildcard) return wildcard.allow !== false && wildcard.enabled !== false;
  return false;
}

function resolveTimestampMs(raw?: string | number): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw * 1000;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) return parsed * 1000;
  }
  return undefined;
}

async function waitForFile(pathname: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fs.promises.stat(pathname);
      return true;
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function inferFileExtension(cdn?: WeworkIncomingImage["cdn"]): string {
  const url = cdn?.url ?? cdn?.md_url ?? cdn?.ld_url ?? "";
  const ext = path.extname(url).toLowerCase();
  if (ext) return ext;
  return ".jpg";
}

async function downloadCdnMedia(params: {
  account: ResolvedWeworkAccount;
  runtime: RuntimeEnv;
  core: WeworkCoreRuntime;
  cdn?: WeworkIncomingImage["cdn"];
  maxBytes: number;
}): Promise<string | undefined> {
  const { account, runtime, core, cdn, maxBytes } = params;
  if (!cdn) return undefined;
  const mode = account.config.mediaDownloadMode ?? "client";
  if (mode === "off") return undefined;

  const dir = resolveDownloadDir(account);
  const timeoutMs = resolveDownloadTimeout(account);
  const extension = inferFileExtension(cdn);
  const hash = cdn.md5?.slice(0, 8) ?? crypto.randomUUID().slice(0, 8);
  const savePath = path.join(dir, `wework-${Date.now()}-${hash}${extension}`);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }

  if (cdn.file_id) {
    const response = await requestWeworkCdnDownload({
      accountId: account.accountId,
      baseUrl: account.baseUrl,
      type: MESSAGE_TYPES.CDN_DOWNLOAD_11170,
      payload: {
        file_id: cdn.file_id,
        aes_key: cdn.aes_key,
        file_size: cdn.file_size ?? cdn.size,
        file_type: cdn.file_type,
        save_path: savePath,
      },
      timeoutMs,
    });
    if (response.success === false) {
      logVerbose(core, runtime, `wework cdn download failed: ${response.error ?? "unknown"}`);
      return undefined;
    }
  } else if (cdn.url) {
    const response = await requestWeworkCdnDownload({
      accountId: account.accountId,
      baseUrl: account.baseUrl,
      type: MESSAGE_TYPES.CDN_DOWNLOAD_11171,
      payload: {
        url: cdn.url,
        auth_key: cdn.auth_key,
        aes_key: cdn.aes_key,
        size: cdn.size,
        save_path: savePath,
      },
      timeoutMs,
    });
    if (response.success === false) {
      logVerbose(core, runtime, `wework cdn download failed: ${response.error ?? "unknown"}`);
      return undefined;
    }
  } else {
    return undefined;
  }

  const exists = await waitForFile(savePath, timeoutMs);
  if (!exists) {
    logVerbose(core, runtime, "wework cdn download timeout waiting for file");
    return undefined;
  }
  try {
    const stats = await fs.promises.stat(savePath);
    if (stats.size > maxBytes) {
      logVerbose(core, runtime, "wework media exceeds configured size limit");
      return undefined;
    }
  } catch {
    return undefined;
  }

  return savePath;
}

async function handleTextMessage(params: {
  data: WeworkIncomingText;
  account: ResolvedWeworkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: WeworkCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const text = params.data.content?.trim();
  if (!text) return;
  if (text.toLowerCase() === "ping") {
    const conversationId = params.data.conversation_id ? String(params.data.conversation_id) : "";
    if (!conversationId) return;
    const senderId = params.data.sender ? String(params.data.sender) : conversationId;
    const receiverId = params.data.receiver ? String(params.data.receiver) : undefined;
    if (receiverId && senderId && receiverId === senderId) {
      logVerbose(params.core, params.runtime, `wework: drop ping from self sender=${senderId}`);
      return;
    }
    params.statusSink?.({ lastInboundAt: Date.now() });
    const result = await sendTextWework(conversationId, "pong", {
      cfg: params.config,
      accountId: params.account.accountId,
    });
    if (!result.ok) {
      params.runtime.error?.(
        `[${params.account.accountId}] WeWork ping auto-reply failed: ${result.error ?? "unknown"}`,
      );
    } else {
      params.statusSink?.({ lastOutboundAt: Date.now() });
      logVerbose(
        params.core,
        params.runtime,
        `wework: ping auto-replied conversation=${conversationId}`,
      );
    }
    return;
  }
  await processMessageWithPipeline({
    ...params,
    rawBody: text,
    mediaPath: undefined,
    mediaType: undefined,
  });
}

async function handleLinkMessage(params: {
  data: WeworkIncomingLink;
  account: ResolvedWeworkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: WeworkCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { title, desc, url } = params.data;
  const lines = [title, desc, url].map((entry) => entry?.trim()).filter(Boolean) as string[];
  if (lines.length === 0) return;
  await processMessageWithPipeline({
    ...params,
    rawBody: lines.join("\n"),
    mediaPath: undefined,
    mediaType: undefined,
  });
}

async function handleImageMessage(params: {
  data: WeworkIncomingImage;
  account: ResolvedWeworkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: WeworkCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  mediaMaxBytes: number;
}): Promise<void> {
  const { account, runtime, core, data, mediaMaxBytes } = params;
  const mediaPath = await downloadCdnMedia({
    account,
    runtime,
    core,
    cdn: data.cdn,
    maxBytes: mediaMaxBytes,
  });
  const rawBody = data.content?.trim() || (mediaPath ? "<media:image>" : "");
  if (!rawBody && !mediaPath) return;
  await processMessageWithPipeline({
    ...params,
    rawBody,
    mediaPath,
    mediaType: mediaPath ? "image" : undefined,
  });
}

async function processMessageWithPipeline(params: {
  data: WeworkIncomingText;
  account: ResolvedWeworkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: WeworkCoreRuntime;
  rawBody: string;
  mediaPath?: string;
  mediaType?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}): Promise<void> {
  const { data, account, config, runtime, core, rawBody, mediaPath, mediaType, statusSink } =
    params;

  const conversationId = data.conversation_id ? String(data.conversation_id) : "";
  if (!conversationId) return;
  const isGroup = isGroupConversation(conversationId);
  const senderId = data.sender ? String(data.sender) : conversationId;
  const receiverId = data.receiver ? String(data.receiver) : undefined;
  const isPc = typeof data.is_pc === "number" ? data.is_pc === 1 : data.is_pc === "1";
  if (isPc) {
    logVerbose(core, runtime, "wework: drop is_pc message");
    return;
  }
  if (receiverId && senderId && receiverId === senderId) {
    logVerbose(core, runtime, `wework: drop self-sent message ${senderId}`);
    return;
  }
  const senderName = data.sender_name ?? "";

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const configAllowFrom = (account.config.allowFrom ?? []).map((v) => String(v));
  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, config);
  const storeAllowFrom =
    !isGroup && (dmPolicy !== "open" || shouldComputeAuth)
      ? await core.channel.pairing.readAllowFromStore("wework").catch(() => [])
      : [];
  const effectiveAllowFrom = [...configAllowFrom, ...storeAllowFrom];
  const useAccessGroups = config.commands?.useAccessGroups !== false;
  const senderAllowedForCommands =
    isSenderAllowed(senderId, effectiveAllowFrom) ||
    isSenderAllowed(conversationId, effectiveAllowFrom);
  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [
          { configured: effectiveAllowFrom.length > 0, allowed: senderAllowedForCommands },
        ],
      })
    : undefined;

  if (!isGroup) {
    if (dmPolicy === "disabled") {
      logVerbose(core, runtime, `Blocked wework DM from ${senderId} (dmPolicy=disabled)`);
      return;
    }
    if (dmPolicy !== "open") {
      const allowed = senderAllowedForCommands;
      if (!allowed) {
        if (dmPolicy === "pairing") {
          const { code, created } = await core.channel.pairing.upsertPairingRequest({
            channel: "wework",
            id: conversationId,
            meta: { name: senderName || undefined, senderId: senderId || undefined },
          });
          if (created) {
            logVerbose(core, runtime, `wework pairing request sender=${senderId}`);
            try {
              await sendTextWework(
                conversationId,
                core.channel.pairing.buildPairingReply({
                  channel: "wework",
                  idLine: `Your WeWork user id: ${senderId}`,
                  code,
                }),
                { cfg: config, accountId: account.accountId },
              );
              statusSink?.({ lastOutboundAt: Date.now() });
            } catch (err) {
              logVerbose(core, runtime, `wework pairing reply failed: ${String(err)}`);
            }
          }
        } else {
          logVerbose(core, runtime, `Blocked unauthorized wework sender ${senderId}`);
        }
        return;
      }
    }
  }

  if (isGroup) {
    const groupPolicy = account.config.groupPolicy ?? "open";
    if (groupPolicy === "disabled") {
      logVerbose(core, runtime, `wework: drop group ${conversationId} (groupPolicy=disabled)`);
      return;
    }
    if (groupPolicy === "allowlist") {
      const groups = account.config.groups ?? {};
      if (!isGroupAllowed({ groupId: conversationId, groups })) {
        logVerbose(core, runtime, `wework: drop group ${conversationId} (not allowlisted)`);
        return;
      }
    }
  }

  if (
    isGroup &&
    core.channel.commands.isControlCommandMessage(rawBody, config) &&
    commandAuthorized !== true
  ) {
    logVerbose(core, runtime, `wework: drop control command from unauthorized sender ${senderId}`);
    return;
  }

  statusSink?.({ lastInboundAt: Date.now() });

  const fromLabel = isGroup ? `group:${conversationId}` : senderName || `user:${senderId}`;
  const route = core.channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "wework",
    accountId: account.accountId,
    peer: { kind: isGroup ? "group" : "dm", id: conversationId },
  });
  const storePath = core.channel.session.resolveStorePath(config.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const timestampMs = resolveTimestampMs(data.send_time);
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "WeWork",
    from: fromLabel,
    timestamp: timestampMs,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });
  const atList = Array.isArray(data.at_list) ? data.at_list.map((entry) => String(entry)) : [];
  const wasMentioned = isGroup ? (receiverId ? atList.includes(receiverId) : false) : undefined;
  const messageIdRaw = data.server_id ?? data.local_id ?? undefined;
  const messageId = messageIdRaw != null ? String(messageIdRaw) : undefined;

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? conversationId : senderId,
    To: conversationId,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: senderName || undefined,
    SenderId: senderId,
    Provider: "wework",
    Surface: "wework",
    MessageSid: messageId,
    MediaPath: mediaPath,
    MediaType: mediaType,
    MediaUrl: mediaPath,
    CommandAuthorized: commandAuthorized,
    WasMentioned: wasMentioned,
    OriginatingChannel: "wework",
    OriginatingTo: conversationId,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`wework: failed updating session meta: ${String(err)}`);
    },
  });

  const tableMode = core.channel.text.resolveMarkdownTableMode({
    cfg: config,
    channel: "wework",
    accountId: account.accountId,
  });
  let prefixOptions: ReturnType<typeof createReplyPrefixOptions> | undefined;
  try {
    prefixOptions = createReplyPrefixOptions({
      cfg: config,
      agentId: route.agentId,
      channel: "wework",
      accountId: account.accountId,
    });
  } catch (err) {
    runtime.error?.(
      `[${account.accountId}] WeWork reply prefix setup failed; continuing without prefix: ${String(err)}`,
    );
  }

  const safeResponsePrefix =
    typeof prefixOptions?.responsePrefix === "string" ? prefixOptions.responsePrefix : undefined;
  if (prefixOptions?.responsePrefix !== undefined && safeResponsePrefix === undefined) {
    runtime.error?.(
      `[${account.accountId}] WeWork responsePrefix must be a string; ignoring invalid value`,
    );
  }

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      ...(prefixOptions
        ? {
            responsePrefix: safeResponsePrefix,
            responsePrefixContextProvider: prefixOptions.responsePrefixContextProvider,
          }
        : {}),
      deliver: async (payload) => {
        await deliverWeworkReply({
          payload,
          conversationId,
          runtime,
          core,
          config,
          accountId: account.accountId,
          statusSink,
          tableMode,
        });
      },
      onSkip: (_payload, info) => {
        logVerbose(core, runtime, `wework: ${info.kind} reply skipped (${info.reason})`);
      },
      onError: (err, info) => {
        runtime.error?.(`[${account.accountId}] WeWork ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: prefixOptions ? { onModelSelected: prefixOptions.onModelSelected } : undefined,
  });
}

async function deliverWeworkReply(params: {
  payload: { text?: string; mediaUrls?: string[]; mediaUrl?: string };
  conversationId: string;
  runtime: RuntimeEnv;
  core: WeworkCoreRuntime;
  config: OpenClawConfig;
  accountId?: string;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  tableMode?: MarkdownTableMode;
}): Promise<void> {
  const { payload, conversationId, runtime, core, config, accountId, statusSink } = params;
  const tableMode = params.tableMode ?? "code";
  const text = core.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  const mediaList = payload.mediaUrls?.length
    ? payload.mediaUrls
    : payload.mediaUrl
      ? [payload.mediaUrl]
      : [];

  if (mediaList.length > 0) {
    for (const mediaUrl of mediaList) {
      const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(
        path.extname(mediaUrl).toLowerCase(),
      );
      const sendResult = isImage
        ? await sendImageWework(conversationId, mediaUrl, { cfg: config, accountId })
        : await sendFileWework(conversationId, mediaUrl, { cfg: config, accountId });
      if (!sendResult.ok) {
        runtime.error?.(`WeWork media send failed: ${sendResult.error ?? "unknown"}`);
      } else {
        statusSink?.({ lastOutboundAt: Date.now() });
      }
    }
    if (text) {
      const chunkMode = core.channel.text.resolveChunkMode(config, "wework", accountId);
      const chunks = core.channel.text.chunkMarkdownTextWithMode(text, 2000, chunkMode);
      for (const chunk of chunks) {
        const result = await sendTextWework(conversationId, chunk, { cfg: config, accountId });
        if (!result.ok) {
          runtime.error?.(`WeWork message send failed: ${result.error ?? "unknown"}`);
        } else {
          statusSink?.({ lastOutboundAt: Date.now() });
        }
      }
    }
    return;
  }

  if (text) {
    const chunkMode = core.channel.text.resolveChunkMode(config, "wework", accountId);
    const chunks = core.channel.text.chunkMarkdownTextWithMode(text, 2000, chunkMode);
    for (const chunk of chunks) {
      const result = await sendTextWework(conversationId, chunk, { cfg: config, accountId });
      if (!result.ok) {
        runtime.error?.(`WeWork message send failed: ${result.error ?? "unknown"}`);
      } else {
        statusSink?.({ lastOutboundAt: Date.now() });
      }
    }
  }
}

async function handleEnvelope(params: {
  envelope: WeworkEnvelope;
  account: ResolvedWeworkAccount;
  config: OpenClawConfig;
  runtime: RuntimeEnv;
  core: WeworkCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  mediaMaxBytes: number;
}): Promise<void> {
  const { envelope, account, config, runtime, core, statusSink, mediaMaxBytes } = params;
  const typeRaw =
    typeof envelope.type === "string" ? Number.parseInt(envelope.type, 10) : envelope.type;
  if (typeof typeRaw !== "number" || Number.isNaN(typeRaw)) return;
  const type = typeRaw;
  const data = envelope.data as Record<string, unknown> | undefined;

  switch (type) {
    case MESSAGE_TYPES.MSG_TEXT:
      await handleTextMessage({
        data: data as WeworkIncomingText,
        account,
        config,
        runtime,
        core,
        statusSink,
      });
      break;
    case MESSAGE_TYPES.MSG_IMAGE:
      await handleImageMessage({
        data: data as WeworkIncomingImage,
        account,
        config,
        runtime,
        core,
        statusSink,
        mediaMaxBytes,
      });
      break;
    case MESSAGE_TYPES.MSG_LINK:
      await handleLinkMessage({
        data: data as WeworkIncomingLink,
        account,
        config,
        runtime,
        core,
        statusSink,
      });
      break;
    case MESSAGE_TYPES.EVENT_LOGIN:
      logVerbose(core, runtime, "wework login event received");
      statusSink?.({ lastInboundAt: Date.now() });
      break;
    case MESSAGE_TYPES.LOGOUT:
      logVerbose(core, runtime, "wework logout event received");
      break;
    case MESSAGE_TYPES.GET_QRCODE:
      logVerbose(core, runtime, "wework qr code event received");
      break;
    default:
      break;
  }
}

export async function monitorWeworkProvider(
  options: WeworkMonitorOptions,
): Promise<WeworkMonitorResult> {
  const { account, config, runtime, abortSignal, statusSink } = options;
  const core = getWeworkRuntime();
  const mediaMaxBytes = resolveMediaMaxMb(account) * 1024 * 1024;

  ensureWeworkBridge(account.accountId);
  const { host, port, messagePath } = resolveListenConfig(account);

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const reqUrl = req.url ?? "/";
    const url = new URL(reqUrl, `http://${req.headers.host ?? host}`);
    if (url.pathname !== messagePath && url.pathname !== `${messagePath}/`) {
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.method === "GET") {
      markWeworkPoll(account.accountId);
      const envelope = dequeueWeworkEnvelope(account.accountId);
      if (!envelope) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(envelope));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    try {
      const body = await readBody(req);
      if (!body.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Empty body" }));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: `Invalid JSON: ${String(err)}` }));
        return;
      }
      const envelope = normalizeWeworkEnvelope(parsed);
      if (!envelope) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Invalid envelope" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));

      const resolved = resolveWeworkResponse(account.accountId, envelope);
      if (resolved) return;
      await handleEnvelope({
        envelope,
        account,
        config,
        runtime,
        core,
        statusSink,
        mediaMaxBytes,
      });
    } catch (err) {
      runtime.error?.(`[${account.accountId}] WeWork webhook error: ${String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Internal Server Error" }));
      }
    }
  });

  const start = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        resolve();
      });
    });

  let stopPromise: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise((resolve) => {
      removeWeworkBridge(account.accountId);
      server.close((err) => {
        if (err && (err as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          runtime.warn?.(`[${account.accountId}] WeWork bridge close error: ${String(err)}`);
        }
        resolve();
      });
    });
    return stopPromise;
  };

  if (abortSignal) {
    abortSignal.addEventListener(
      "abort",
      () => {
        void stop();
      },
      { once: true },
    );
  }

  try {
    await start();
  } catch (err) {
    removeWeworkBridge(account.accountId);
    throw err;
  }
  runtime.log?.(
    `[${account.accountId}] WeWork bridge listening on http://${host}:${port}${messagePath}`,
  );
  return { stop };
}
