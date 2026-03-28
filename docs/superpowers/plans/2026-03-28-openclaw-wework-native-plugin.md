# OpenClaw WeWork Native Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `openclaw-wework` load as a standard native OpenClaw plugin on `2026.3.x`, while preserving npm install, `--link`, and manual directory-copy workflows.

**Architecture:** Keep the repository root as the plugin root, and treat metadata consistency as the first-order problem. Add repo-local discovery tests so this package can validate itself without depending on the upstream OpenClaw monorepo test helpers. Upgrade package metadata to the current `openclaw.install.minHostVersion` contract, then document the supported install paths and manual-copy prerequisites.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin SDK, JSON package metadata

---

## File Structure

### Files to create

- `tsconfig.json`
- `vitest.config.ts`
- `src/plugin-metadata.test.ts`
- `src/plugin-entry.test.ts`
- `README.md`

### Files to modify

- `package.json`

### Files to modify only if smoke verification proves they are part of discovery failure

- `openclaw.plugin.json`
- `index.ts`
- `setup-entry.ts`

### Files to verify only

- `src/channel.ts`
- `src/runtime.ts`

These source files should only change if the new entry smoke tests prove that entry registration pulls in unsafe startup work.

### Task 1: Make The Repo Self-Testable

**Files:**
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/plugin-metadata.test.ts`

- [ ] **Step 1: Write the failing metadata tests**

```ts
// src/plugin-metadata.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
const pluginManifest = JSON.parse(readFileSync(path.join(rootDir, "openclaw.plugin.json"), "utf8"));

describe("native plugin metadata", () => {
  it("keeps the package install target aligned with the published package name", () => {
    expect(packageJson.name).toBe("@tans/openclaw-wework");
    expect(packageJson.openclaw.install.npmSpec).toBe(packageJson.name);
  });

  it("declares a current 2026.3.x host floor through openclaw.install.minHostVersion", () => {
    expect(packageJson.openclaw.install.minHostVersion).toBe(">=2026.3.22");
    expect(packageJson.peerDependencies.openclaw).toBe(">=2026.3.22");
  });

  it("keeps the plugin discovery identifiers stable", () => {
    expect(pluginManifest.id).toBe("openclaw-wework");
    expect(pluginManifest.kind).toBe("channel");
    expect(pluginManifest.channels).toEqual(["wework"]);
    expect(packageJson.openclaw.extensions).toEqual(["./index.ts"]);
    expect(packageJson.openclaw.setupEntry).toBe("./setup-entry.ts");
  });
});
```

- [ ] **Step 2: Run the new test file and confirm it fails on current metadata**

Run: `bunx vitest run src/plugin-metadata.test.ts`

Expected: FAIL because the repository does not yet have a local Vitest config, `package.json.name` does not match `openclaw.install.npmSpec`, and `openclaw.install.minHostVersion` is not defined.

- [ ] **Step 3: Add local test configuration so this repo can validate itself without monorepo-only helpers**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["vitest/globals", "node"],
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": [
    "index.ts",
    "setup-entry.ts",
    "src/**/*.ts",
    "vitest.config.ts"
  ]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Re-run the metadata tests**

Run: `bunx vitest run src/plugin-metadata.test.ts`

Expected: FAIL only on the actual metadata assertions, proving the repo-local test harness now works.

- [ ] **Step 5: Commit the harness and failing assertions**

```bash
git add tsconfig.json vitest.config.ts src/plugin-metadata.test.ts
git commit -m "test: add standalone plugin metadata checks"
```

### Task 2: Normalize `package.json` For OpenClaw 2026.3.x

**Files:**
- Modify: `package.json`
- Test: `src/plugin-metadata.test.ts`

- [ ] **Step 1: Expand the metadata test to assert modern install metadata and optional peer dependency handling**

```ts
// src/plugin-metadata.test.ts
it("marks openclaw as an optional peer and opts into npm publishing metadata", () => {
  expect(packageJson.peerDependenciesMeta).toEqual({
    openclaw: {
      optional: true,
    },
  });
  expect(packageJson.openclaw.release).toEqual({
    publishToNpm: true,
  });
});
```

- [ ] **Step 2: Run the metadata tests and confirm the new assertions fail**

Run: `bunx vitest run src/plugin-metadata.test.ts`

Expected: FAIL because `peerDependenciesMeta` and `openclaw.release.publishToNpm` are not present yet.

- [ ] **Step 3: Update `package.json` to the current native plugin install contract**

```json
{
  "name": "@tans/openclaw-wework",
  "version": "2026.1.29",
  "type": "module",
  "description": "OpenClaw WeWork channel plugin",
  "openclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "channel": {
      "id": "wework",
      "label": "WeWork",
      "selectionLabel": "WeWork (HTTP bridge)",
      "docsPath": "/channels/wework",
      "docsLabel": "wework",
      "blurb": "Enterprise WeChat via local HTTP bridge.",
      "aliases": ["wecom", "qywx"],
      "order": 85,
      "quickstartAllowFrom": true
    },
    "install": {
      "npmSpec": "@tans/openclaw-wework",
      "localPath": "extensions/wework",
      "defaultChoice": "npm",
      "minHostVersion": ">=2026.3.22"
    },
    "release": {
      "publishToNpm": true
    }
  },
  "dependencies": {
    "undici": "7.19.0"
  },
  "peerDependencies": {
    "openclaw": ">=2026.3.22"
  },
  "peerDependenciesMeta": {
    "openclaw": {
      "optional": true
    }
  },
  "devDependencies": {
    "openclaw": "workspace:*"
  }
}
```

- [ ] **Step 4: Re-run the metadata tests**

Run: `bunx vitest run src/plugin-metadata.test.ts`

Expected: PASS for the metadata assertions added in Tasks 1 and 2.

- [ ] **Step 5: Commit the package metadata upgrade**

```bash
git add package.json src/plugin-metadata.test.ts
git commit -m "feat: align package metadata with current openclaw install contract"
```

### Task 3: Add Entry Smoke Tests And Keep Registration Thin

**Files:**
- Create: `src/plugin-entry.test.ts`
- Modify: `index.ts`
- Modify: `setup-entry.ts`
- Verify only: `src/channel.ts`
- Verify only: `src/runtime.ts`

- [ ] **Step 1: Write a smoke test that imports the plugin entrypoints directly**

```ts
// src/plugin-entry.test.ts
import { describe, expect, it } from "vitest";

describe("plugin entrypoints", () => {
  it("imports the primary entry without throwing", async () => {
    const entry = await import("../index.ts");
    expect(entry.default).toBeTruthy();
  });

  it("imports the setup entry without throwing", async () => {
    const setupEntry = await import("../setup-entry.ts");
    expect(setupEntry.default).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the entry smoke tests**

Run: `bunx vitest run src/plugin-entry.test.ts`

Expected: PASS if entrypoints are already thin enough, or FAIL with an import-time error that points to eager startup work.

- [ ] **Step 3: If the smoke tests fail, keep `index.ts` and `setup-entry.ts` as registration-only files**

```ts
// index.ts
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";

import { weworkPlugin } from "./src/channel.js";
import { setWeworkRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "openclaw-wework",
  name: "WeWork",
  description: "WeWork channel plugin",
  plugin: weworkPlugin,
  setRuntime: setWeworkRuntime,
});
```

```ts
// setup-entry.ts
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";

import { weworkPlugin } from "./src/channel.js";

export default defineSetupPluginEntry(weworkPlugin);
```

If import-time errors still originate from `src/channel.ts` or `src/runtime.ts`, move only the eager side effects behind runtime functions; do not rewrite channel behavior.

- [ ] **Step 4: Run both repo-local test files together**

Run: `bunx vitest run src/plugin-metadata.test.ts src/plugin-entry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the smoke-test coverage**

```bash
git add src/plugin-entry.test.ts index.ts setup-entry.ts
git commit -m "test: add entrypoint smoke coverage"
```

### Task 4: Document Supported Install Modes And Manual-Copy Prerequisites

**Files:**
- Create: `README.md`
- Test: `src/plugin-metadata.test.ts`

- [ ] **Step 1: Extend the metadata test to keep install examples aligned with the package name**

```ts
// src/plugin-metadata.test.ts
it("uses the published package name in install documentation examples", () => {
  const readme = readFileSync(path.join(rootDir, "README.md"), "utf8");
  expect(readme).toContain("openclaw plugins install @tans/openclaw-wework");
  expect(readme).toContain("openclaw plugins install --link /path/to/openclaw-wework");
  expect(readme).toContain("cp -R . ~/.openclaw/extensions/openclaw-wework");
  expect(readme).toContain("cd ~/.openclaw/extensions/openclaw-wework && npm install");
});
```

- [ ] **Step 2: Run the metadata test and confirm the README assertions fail**

Run: `bunx vitest run src/plugin-metadata.test.ts`

Expected: FAIL because `README.md` does not exist yet.

- [ ] **Step 3: Add a README that matches the supported install contract**

~~~md
# OpenClaw WeWork

Native OpenClaw WeWork channel plugin.

## Install

Preferred:

```bash
openclaw plugins install @tans/openclaw-wework
```

Local source checkout:

```bash
openclaw plugins install --link /path/to/openclaw-wework
```

Manual copy:

```bash
mkdir -p ~/.openclaw/extensions
cp -R . ~/.openclaw/extensions/openclaw-wework
cd ~/.openclaw/extensions/openclaw-wework && npm install
```

## Verify

```bash
openclaw plugins list
openclaw plugins inspect openclaw-wework
openclaw doctor
openclaw gateway status --deep
```
~~~

- [ ] **Step 4: Re-run the repo-local test suite**

Run: `bunx vitest run src/plugin-metadata.test.ts src/plugin-entry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit the install documentation**

```bash
git add README.md src/plugin-metadata.test.ts
git commit -m "docs: document native plugin install paths"
```

### Task 5: Run OpenClaw Smoke Verification Against The Real Host

**Files:**
- Verify only: `package.json`
- Verify only: `openclaw.plugin.json`
- Verify only: `README.md`

- [ ] **Step 1: Remove any stale installed copy and install from the local checkout**

Run: `openclaw plugins install --link /Users/ke/code/openclaw-wework`

Expected: success message showing the plugin was linked or updated.

- [ ] **Step 2: Confirm the plugin is discoverable**

Run: `openclaw plugins inspect openclaw-wework`

Expected: output includes the plugin id `openclaw-wework` and no "plugin not found" error.

- [ ] **Step 3: Confirm the plugin appears in the plugin list**

Run: `openclaw plugins list`

Expected: `openclaw-wework` appears in the installed/discovered plugin table.

- [ ] **Step 4: Run config and gateway diagnostics**

Run: `openclaw doctor`

Expected: no warning for `plugins.entries.openclaw-wework` or `plugins.allow: plugin not found: openclaw-wework`.

Run: `openclaw gateway status --deep`

Expected: plugin discovery no longer blocks gateway startup; any remaining errors should be runtime-specific rather than discovery-specific.

- [ ] **Step 5: Commit any final metadata or docs fixes discovered during smoke verification**

```bash
git add package.json openclaw.plugin.json index.ts setup-entry.ts README.md src/plugin-metadata.test.ts src/plugin-entry.test.ts tsconfig.json vitest.config.ts
git commit -m "fix: make wework plugin discoverable as a native openclaw plugin"
```

## Self-Review

### Spec Coverage

- Discovery/registration reliability: covered by Tasks 1, 2, 3, and 5
- npm install, `--link`, and manual copy workflows: covered by Tasks 2, 4, and 5
- Minimal business-logic churn: covered by Task 3's "verify only" boundary for `src/channel.ts` and `src/runtime.ts`
- Diagnosable failures: covered by repo-local tests plus OpenClaw CLI smoke checks in Task 5

### Placeholder Scan

- No placeholder markers or deferred implementation notes remain
- Every code-editing step includes concrete file content
- Every verification step includes an exact command and expected result

### Type Consistency

- Plugin id stays `openclaw-wework` in tests, metadata assertions, README verification, and CLI smoke checks
- Channel id stays `wework`
- Published package name stays `@tans/openclaw-wework`
- Host floor stays `>=2026.3.22`
