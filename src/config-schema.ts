import type { ChannelConfigSchema } from "openclaw/plugin-sdk";

const allowFromEntry = {
  anyOf: [{ type: "string" }, { type: "number" }],
};

const markdownSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tables: { type: "string", enum: ["off", "bullets", "code"] },
  },
};

const groupEntrySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    allow: { type: "boolean" },
    enabled: { type: "boolean" },
  },
};

const weworkAccountSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    enabled: { type: "boolean" },
    markdown: markdownSchema,
    baseUrl: { type: "string" },
    dmPolicy: { type: "string", enum: ["pairing", "allowlist", "open", "disabled"] },
    allowFrom: { type: "array", items: allowFromEntry },
    groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
    groups: {
      type: "object",
      additionalProperties: groupEntrySchema,
    },
    mediaMaxMb: { type: "number" },
    pollEmptyDelayMs: { type: "number" },
    mediaDownloadMode: { type: "string", enum: ["client", "off"] },
    mediaDownloadDir: { type: "string" },
    mediaDownloadTimeoutMs: { type: "number" },
  },
};

export const weworkConfigSchema: ChannelConfigSchema = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...weworkAccountSchema.properties,
      accounts: {
        type: "object",
        additionalProperties: weworkAccountSchema,
      },
      defaultAccount: { type: "string" },
    },
  },
};
