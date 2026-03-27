import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  OpenClawConfig,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  promptAccountId,
} from "openclaw/plugin-sdk";

import {
  DEFAULT_WEWORK_BASE_URL,
  listWeworkAccountIds,
  resolveDefaultWeworkAccountId,
  resolveWeworkAccount,
} from "./accounts.js";

const channel = "wework" as const;

function setWeworkDmPolicy(
  cfg: OpenClawConfig,
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled",
) {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.wework?.allowFrom)
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      wework: {
        ...cfg.channels?.wework,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  } as OpenClawConfig;
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptWeworkAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<OpenClawConfig> {
  const { cfg, prompter, accountId } = params;
  const resolved = resolveWeworkAccount({ cfg, accountId });
  const existingAllowFrom = resolved.config.allowFrom ?? [];
  const entry = await prompter.text({
    message: "WeWork allowFrom (user id)",
    placeholder: "168888888888",
    initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
    validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
  });
  const parts = parseAllowFromInput(String(entry));
  const merged = [
    ...existingAllowFrom.map((item) => String(item).trim()).filter(Boolean),
    ...parts,
  ];
  const unique = [...new Set(merged)];

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        wework: {
          ...cfg.channels?.wework,
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: unique,
        },
      },
    } as OpenClawConfig;
  }

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      wework: {
        ...cfg.channels?.wework,
        enabled: true,
        accounts: {
          ...(cfg.channels?.wework?.accounts ?? {}),
          [accountId]: {
            ...(cfg.channels?.wework?.accounts?.[accountId] ?? {}),
            enabled: true,
            dmPolicy: "allowlist",
            allowFrom: unique,
          },
        },
      },
    },
  } as OpenClawConfig;
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "WeWork",
  channel,
  policyKey: "channels.wework.dmPolicy",
  allowFromKey: "channels.wework.allowFrom",
  getCurrent: (cfg) => (cfg.channels?.wework?.dmPolicy ?? "pairing") as "pairing",
  setPolicy: (cfg, policy) => setWeworkDmPolicy(cfg as OpenClawConfig, policy),
  promptAllowFrom: async ({ cfg, prompter, accountId }) => {
    const id =
      accountId && normalizeAccountId(accountId)
        ? normalizeAccountId(accountId) ?? DEFAULT_ACCOUNT_ID
        : resolveDefaultWeworkAccountId(cfg as OpenClawConfig);
    return promptWeworkAllowFrom({ cfg: cfg as OpenClawConfig, prompter, accountId: id });
  },
};

function applyAccountConfig(params: {
  cfg: OpenClawConfig;
  accountId: string;
  baseUrl: string;
}): OpenClawConfig {
  const { cfg, accountId, baseUrl } = params;
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        wework: {
          ...cfg.channels?.wework,
          enabled: true,
          baseUrl,
        },
      },
    } as OpenClawConfig;
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      wework: {
        ...cfg.channels?.wework,
        enabled: true,
        accounts: {
          ...(cfg.channels?.wework?.accounts ?? {}),
          [accountId]: {
            ...(cfg.channels?.wework?.accounts?.[accountId] ?? {}),
            enabled: true,
            baseUrl,
          },
        },
      },
    },
  } as OpenClawConfig;
}

export const weworkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  dmPolicy,
  getStatus: async ({ cfg }) => {
    const configured = listWeworkAccountIds(cfg as OpenClawConfig).some((accountId) =>
      Boolean(resolveWeworkAccount({ cfg: cfg as OpenClawConfig, accountId }).baseUrl),
    );
    return {
      channel,
      configured,
      statusLines: [`WeWork: ${configured ? "configured" : "needs baseUrl"}`],
      selectionHint: configured ? "configured" : "local bridge",
      quickstartScore: configured ? 2 : 8,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds, forceAllowFrom }) => {
    const weworkOverride = accountOverrides.wework?.trim();
    const defaultAccountId = resolveDefaultWeworkAccountId(cfg as OpenClawConfig);
    let accountId = weworkOverride ? normalizeAccountId(weworkOverride) : defaultAccountId;
    if (shouldPromptAccountIds && !weworkOverride) {
      accountId = await promptAccountId({
        cfg: cfg as OpenClawConfig,
        prompter,
        label: "WeWork",
        currentId: accountId,
        listAccountIds: listWeworkAccountIds,
        defaultAccountId,
      });
    }

    const resolved = resolveWeworkAccount({ cfg: cfg as OpenClawConfig, accountId });
    const baseUrl = await prompter.text({
      message: "WeWork bridge listen URL",
      placeholder: DEFAULT_WEWORK_BASE_URL,
      initialValue: resolved.baseUrl ?? DEFAULT_WEWORK_BASE_URL,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    });

    let next = applyAccountConfig({
      cfg: cfg as OpenClawConfig,
      accountId,
      baseUrl: String(baseUrl).trim(),
    });

    if (forceAllowFrom) {
      next = await dmPolicy.promptAllowFrom({ cfg: next, prompter, accountId });
    }

    return next;
  },
};
