import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const runtimeStore = createPluginRuntimeStore<PluginRuntime>(
  "WeWork runtime not initialized",
);

export const setWeworkRuntime = (next: PluginRuntime): void => {
  runtimeStore.setRuntime(next);
};

export const getWeworkRuntime = (): PluginRuntime => runtimeStore.getRuntime();

export const tryGetWeworkRuntime = (): PluginRuntime | null =>
  runtimeStore.tryGetRuntime();
