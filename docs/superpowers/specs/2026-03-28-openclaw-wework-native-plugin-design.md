# OpenClaw WeWork Native Plugin Design

Date: 2026-03-28
Project: `openclaw-wework`
Scope: Normalize the repository as a standard native OpenClaw plugin and resolve plugin discovery failures on OpenClaw `2026.3.x`.

## Context

The current repository already follows the native plugin shape:

- [`package.json`](/Users/ke/code/openclaw-wework/package.json) contains the `openclaw` metadata block
- [`openclaw.plugin.json`](/Users/ke/code/openclaw-wework/openclaw.plugin.json) contains the plugin manifest and config schema
- [`index.ts`](/Users/ke/code/openclaw-wework/index.ts) defines the primary channel plugin entry
- [`setup-entry.ts`](/Users/ke/code/openclaw-wework/setup-entry.ts) defines the setup entry

The reported failure on OpenClaw `2026.3.24` is:

- `plugins.entries.openclaw-wework: plugin not found: openclaw-wework`
- `plugins.allow: plugin not found: openclaw-wework`

This indicates discovery/registration failure before normal runtime behavior, not only an API version mismatch.

## Problem Statement

`openclaw-wework` needs to work as a standard native OpenClaw plugin in three usage modes:

1. Official install from npm via `openclaw plugins install @tans/openclaw-wework`
2. Local development install via `openclaw plugins install --link /path/to/openclaw-wework`
3. Manual directory copy to `~/.openclaw/extensions/openclaw-wework`

The current repository shape is close, but the design must explicitly guarantee that the repository root is itself a valid plugin root and that discovery metadata stays consistent across OpenClaw versions, especially `2026.3.x`.

## Goals

- Keep the plugin in native OpenClaw format
- Make the repository root the canonical plugin root
- Support both official install flows and manual directory copy
- Preserve the current channel id `wework`
- Preserve the current plugin id `openclaw-wework`
- Minimize business-logic changes in `src/`
- Make discovery failures diagnosable and deterministic

## Non-Goals

- Do not convert the project into a bundle plugin
- Do not introduce a required build-only release artifact such as `dist/`
- Do not redesign the WeWork channel behavior itself
- Do not expand scope into unrelated refactors

## Chosen Approach

Use a zero-build native plugin root as the only supported project shape.

The repository root remains both:

- the development workspace
- the installable plugin root

OpenClaw must be able to discover the plugin directly from the repository root without any wrapper directory or publish-only layout. The plugin contract is centered on four root files:

- [`package.json`](/Users/ke/code/openclaw-wework/package.json)
- [`openclaw.plugin.json`](/Users/ke/code/openclaw-wework/openclaw.plugin.json)
- [`index.ts`](/Users/ke/code/openclaw-wework/index.ts)
- [`setup-entry.ts`](/Users/ke/code/openclaw-wework/setup-entry.ts)

## Discovery Contract

The plugin must satisfy these discovery invariants:

- Plugin root directory is the directory OpenClaw scans or installs
- Plugin id is exactly `openclaw-wework`
- The config references under `plugins.entries.openclaw-wework` and `plugins.allow` must resolve to that same id
- The plugin manifest and package metadata must not disagree about plugin identity or entrypoints
- The directory must be usable as-is when copied under `~/.openclaw/extensions/openclaw-wework`

The design assumes that OpenClaw `2026.3.x` treats missing or invalid discovery metadata as "plugin not found", so registration must succeed before any deeper runtime loading occurs.

## Metadata Contract

### `openclaw.plugin.json`

Responsibilities:

- declare plugin identity
- declare plugin kind and supported channel ids
- declare the config schema

Constraints:

- `id` remains `openclaw-wework`
- `kind` remains `channel`
- `channels` remains `["wework"]`
- schema remains focused on user configuration, not install mechanics

### `package.json`

Responsibilities:

- package identity and published package name
- OpenClaw-native metadata under `openclaw`
- compatibility floor
- install guidance for npm and local extension placement

Constraints:

- `name` remains the published package name
- `openclaw.extensions` points to the root entry file
- `openclaw.setupEntry` points to the setup entry file
- `openclaw.compat.pluginApi` becomes the single compatibility baseline for native plugin API support
- `peerDependencies.openclaw` must stay aligned with the same baseline instead of drifting independently
- `openclaw.install.npmSpec` remains the official install target
- `openclaw.install.localPath` must align with the plugin id based install location rather than a divergent channel-only name

## Entry Point Design

### Primary entry

[`index.ts`](/Users/ke/code/openclaw-wework/index.ts) remains a thin registration layer:

- import the channel plugin implementation
- register the plugin via the OpenClaw plugin SDK
- avoid incidental boot-time work beyond registration wiring

### Setup entry

[`setup-entry.ts`](/Users/ke/code/openclaw-wework/setup-entry.ts) remains a thin setup layer:

- expose onboarding/setup integration
- avoid unrelated side effects during plugin discovery

The intent is to ensure that plugin discovery does not fail because startup logic performs unnecessary work too early.

## Runtime Dependency Strategy

Because manual directory copy must stay supported, the plugin cannot depend on a release process that generates a separate build artifact. The plugin should therefore be operable directly from source form.

This design sets these requirements:

- no required `dist/` output
- no requirement that OpenClaw points at a publish-only directory
- runtime dependencies must be explicit and minimal
- startup-time imports should stay narrow so discovery can succeed even when deeper runtime paths are not yet exercised

This does not promise that a random partial copy of the repository will work. It only defines that the full repository root is a valid plugin root.

## Compatibility Strategy

Compatibility is defined in layers:

### Discovery compatibility

Primary target:

- OpenClaw `2026.3.x`

Requirement:

- discovery succeeds and config ids resolve without `plugin not found`

### API compatibility

Primary baseline:

- keep the existing floor near `>=2026.1.26`, subject to verification against current SDK expectations

Requirement:

- the plugin advertises one clear minimum supported native plugin API version
- the `peerDependencies.openclaw` range and `openclaw.compat.pluginApi` range are aligned

### Behavioral compatibility

Requirement:

- newer OpenClaw versions may expose richer inspection or install flows
- older versions only need to load the plugin cleanly and preserve core WeWork channel behavior

## Install Modes

### npm install

Official production path:

- `openclaw plugins install @tans/openclaw-wework`

Expectation:

- package metadata alone is sufficient for OpenClaw to install and register the plugin

### Local link install

Development path:

- `openclaw plugins install --link /path/to/openclaw-wework`

Expectation:

- repository root is recognized as the plugin root
- linked installs use the same manifest and entrypoint contract as npm installs

### Manual copy

Fallback path:

- copy repository root to `~/.openclaw/extensions/openclaw-wework`

Expectation:

- OpenClaw discovery sees the copied directory as a valid plugin root
- the plugin registers under `openclaw-wework`
- config entries referencing `openclaw-wework` no longer warn as stale

Directory naming rule:

- the canonical directory name for manual placement is `openclaw-wework`
- install metadata must not advertise a conflicting shorter path such as `extensions/wework`
- if OpenClaw uses `localPath` during install, that path must resolve to the same plugin identity seen by config and discovery

## Error Handling

The design prefers explicit diagnosis over silent fallback.

Expected behavior:

- invalid or inconsistent ids should surface as discovery failure
- unsupported OpenClaw versions should surface as compatibility failure, not as fake absence
- missing runtime prerequisites should surface as load/runtime errors, not as "plugin not found" when discovery metadata is present

This distinction matters because the current symptom incorrectly looks like the plugin does not exist, which obscures root cause analysis.

## Testing And Verification

Verification for implementation must cover:

1. Discovery by copied directory
2. Discovery by linked local install
3. Discovery by npm-installed package metadata
4. Entry registration consistency between manifest, package metadata, and runtime registration
5. No stale-config warning for `plugins.entries.openclaw-wework` when the plugin is installed correctly

Suggested commands for implementation verification:

- `openclaw doctor`
- `openclaw gateway status --deep`
- `openclaw plugins inspect openclaw-wework`
- `openclaw plugins list`

Success criteria:

- `openclaw-wework` appears in plugin inspection/list output
- `plugins.entries.openclaw-wework` is accepted
- `plugins.allow` accepts `openclaw-wework`
- startup no longer reports the plugin as missing

## Implementation Boundaries

The implementation should prioritize:

1. metadata consistency
2. discovery-path reliability
3. install-path clarity
4. only then runtime cleanup if discovery is still blocked

The implementation should avoid broad refactors in `src/` unless inspection proves that early imports or side effects prevent registration.

## Risks

- OpenClaw `2026.3.x` may have tightened discovery expectations beyond what the current metadata expresses
- manual copy mode can still fail if required dependencies are not actually present in the copied directory
- source-form `.ts` loading may behave differently across OpenClaw versions if the host runtime changes

## Open Questions Resolved In This Design

- Native format vs bundle format: native format
- Official install vs manual copy: both, with official install as the preferred path
- Build artifact requirement: no required build artifact
- Canonical plugin root: repository root
- Plugin id stability: keep `openclaw-wework`

## Outcome

The implementation plan that follows this design should standardize `openclaw-wework` as a native OpenClaw plugin whose repository root is directly installable, discoverable, and compatible with current OpenClaw plugin discovery expectations, while preserving npm install and manual copy workflows.
