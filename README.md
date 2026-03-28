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
