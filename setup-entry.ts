import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";

import { weworkPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(weworkPlugin);
