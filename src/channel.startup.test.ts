import type {
  ChannelAccountSnapshot,
  ChannelGatewayContext,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeEnv } from "../../test-utils/runtime-env.js";
import type { ResolvedWeworkAccount } from "./types.js";

const hoisted = vi.hoisted(() => ({
  monitorWeworkProvider: vi.fn(),
}));

vi.mock("./monitor.js", async () => {
  const actual = await vi.importActual<typeof import("./monitor.js")>("./monitor.js");
  return {
    ...actual,
    monitorWeworkProvider: hoisted.monitorWeworkProvider,
  };
});

import { weworkPlugin } from "./channel.js";

function createStartAccountCtx(params: {
  account: ResolvedWeworkAccount;
  abortSignal: AbortSignal;
}): ChannelGatewayContext<ResolvedWeworkAccount> {
  const snapshot: ChannelAccountSnapshot = {
    accountId: params.account.accountId,
    configured: true,
    enabled: true,
    running: false,
  };
  return {
    accountId: params.account.accountId,
    account: params.account,
    cfg: {} as OpenClawConfig,
    runtime: createRuntimeEnv(),
    abortSignal: params.abortSignal,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getStatus: () => snapshot,
    setStatus: (next) => {
      Object.assign(snapshot, next);
    },
  };
}

function buildAccount(): ResolvedWeworkAccount {
  return {
    accountId: "default",
    enabled: true,
    baseUrl: "http://127.0.0.1:6255",
    config: {},
  };
}

describe("weworkPlugin gateway.startAccount", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps startAccount pending until abort, then stops monitor", async () => {
    const stop = vi.fn();
    hoisted.monitorWeworkProvider.mockResolvedValue({ stop });
    const abort = new AbortController();

    const task = weworkPlugin.gateway!.startAccount!(
      createStartAccountCtx({
        account: buildAccount(),
        abortSignal: abort.signal,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    let settled = false;
    void task.then(() => {
      settled = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(hoisted.monitorWeworkProvider).toHaveBeenCalledOnce();
    expect(stop).not.toHaveBeenCalled();

    abort.abort();
    await task;

    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops immediately when startAccount receives an already-aborted signal", async () => {
    const stop = vi.fn();
    hoisted.monitorWeworkProvider.mockResolvedValue({ stop });
    const abort = new AbortController();
    abort.abort();

    await weworkPlugin.gateway!.startAccount!(
      createStartAccountCtx({
        account: buildAccount(),
        abortSignal: abort.signal,
      }),
    );

    expect(hoisted.monitorWeworkProvider).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });
});
