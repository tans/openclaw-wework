import path from "node:path";

import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionName,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk";

import { listEnabledWeworkAccounts } from "./accounts.js";
import { sendFileWework, sendImageWework, sendTextWework } from "./send.js";

const providerId = "wework";

function listEnabledAccounts(cfg: OpenClawConfig) {
  return listEnabledWeworkAccounts(cfg).filter((account) => account.enabled);
}

function isImagePath(raw: string): boolean {
  const ext = path.extname(raw).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext);
}

export const weworkMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) => {
    const accounts = listEnabledAccounts(cfg as OpenClawConfig);
    if (accounts.length === 0) return [];
    const actions = new Set<ChannelMessageActionName>(["send"]);
    return Array.from(actions);
  },
  supportsButtons: () => false,
  extractToolSend: ({ args }) => {
    const action = typeof args.action === "string" ? args.action.trim() : "";
    if (action !== "sendMessage") return null;
    const to = typeof args.to === "string" ? args.to : undefined;
    if (!to) return null;
    const accountId = typeof args.accountId === "string" ? args.accountId.trim() : undefined;
    return { to, accountId };
  },
  handleAction: async ({ action, params, cfg, accountId }) => {
    if (action === "send") {
      const to = readStringParam(params, "to", { required: true });
      const content = readStringParam(params, "message", {
        required: true,
        allowEmpty: true,
      });
      const media = readStringParam(params, "media", { trim: false });

      if (media) {
        const mediaResult = isImagePath(media)
          ? await sendImageWework(to ?? "", media, { cfg: cfg as OpenClawConfig, accountId })
          : await sendFileWework(to ?? "", media, { cfg: cfg as OpenClawConfig, accountId });
        if (!mediaResult.ok) {
          return jsonResult({ ok: false, error: mediaResult.error ?? "Failed to send media" });
        }
        if (content) {
          const textResult = await sendTextWework(to ?? "", content, {
            cfg: cfg as OpenClawConfig,
            accountId,
          });
          if (!textResult.ok) {
            return jsonResult({ ok: false, error: textResult.error ?? "Failed to send text" });
          }
        }
        return jsonResult({ ok: true, to });
      }

      const result = await sendTextWework(to ?? "", content ?? "", {
        cfg: cfg as OpenClawConfig,
        accountId,
      });

      if (!result.ok) {
        return jsonResult({ ok: false, error: result.error ?? "Failed to send WeWork message" });
      }

      return jsonResult({ ok: true, to });
    }

    throw new Error(`Action ${action} is not supported for provider ${providerId}.`);
  },
};
