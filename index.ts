import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";

import { weworkPlugin } from "./src/channel.js";
import { setWeworkRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "wework",
  name: "WeWork",
  description: "WeWork channel plugin",
  plugin: weworkPlugin,
  setRuntime: setWeworkRuntime,
});
