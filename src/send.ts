import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import { enqueueWeworkMessage } from "./api.js";
import { resolveWeworkAccount } from "./accounts.js";

export type WeworkSendOptions = {
  accountId?: string;
  cfg?: OpenClawConfig;
  atList?: string[];
};

export type WeworkSendResult = {
  ok: boolean;
  error?: string;
};

function resolveSendContext(options: WeworkSendOptions): {
  accountId?: string;
} {
  if (options.cfg) {
    const account = resolveWeworkAccount({ cfg: options.cfg, accountId: options.accountId });
    return { accountId: account.accountId };
  }
  return { accountId: options.accountId };
}

export async function sendTextWework(
  conversationId: string,
  text: string,
  options: WeworkSendOptions = {},
): Promise<WeworkSendResult> {
  if (!conversationId?.trim()) return { ok: false, error: "No conversation_id provided" };
  const { accountId } = resolveSendContext(options);
  if (!accountId) return { ok: false, error: "No account configured" };

  const envelope = options.atList && options.atList.length > 0
    ? {
        type: 11069,
        data: {
          conversation_id: conversationId,
          content: text,
          at_list: options.atList,
        },
      }
    : {
        type: 11029,
        data: {
          conversation_id: conversationId,
          content: text,
        },
      };

  const response = await enqueueWeworkMessage({
    accountId,
    envelope,
  });

  const ok = response.success !== false;
  return ok ? { ok: true } : { ok: false, error: response.error ?? "send failed" };
}

export async function sendImageWework(
  conversationId: string,
  filePath: string,
  options: WeworkSendOptions = {},
): Promise<WeworkSendResult> {
  if (!conversationId?.trim()) return { ok: false, error: "No conversation_id provided" };
  if (!filePath?.trim()) return { ok: false, error: "No file path provided" };
  const { accountId } = resolveSendContext(options);
  if (!accountId) return { ok: false, error: "No account configured" };

  const response = await enqueueWeworkMessage({
    accountId,
    envelope: {
      type: 11030,
      data: { conversation_id: conversationId, file: filePath },
    },
  });

  const ok = response.success !== false;
  return ok ? { ok: true } : { ok: false, error: response.error ?? "send failed" };
}

export async function sendFileWework(
  conversationId: string,
  filePath: string,
  options: WeworkSendOptions = {},
): Promise<WeworkSendResult> {
  if (!conversationId?.trim()) return { ok: false, error: "No conversation_id provided" };
  if (!filePath?.trim()) return { ok: false, error: "No file path provided" };
  const { accountId } = resolveSendContext(options);
  if (!accountId) return { ok: false, error: "No account configured" };

  const response = await enqueueWeworkMessage({
    accountId,
    envelope: {
      type: 11031,
      data: { conversation_id: conversationId, file: filePath },
    },
  });

  const ok = response.success !== false;
  return ok ? { ok: true } : { ok: false, error: response.error ?? "send failed" };
}
