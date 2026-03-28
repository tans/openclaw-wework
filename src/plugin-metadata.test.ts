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

  it("keeps the plugin discovery identifiers stable", () => {
    expect(pluginManifest.id).toBe("openclaw-wework");
    expect(pluginManifest.kind).toBe("channel");
    expect(pluginManifest.channels).toEqual(["wework"]);
    expect(packageJson.openclaw.extensions).toEqual(["./index.ts"]);
    expect(packageJson.openclaw.setupEntry).toBe("./setup-entry.ts");
  });

  it("uses the published package name in install documentation examples", () => {
    const readme = readFileSync(path.join(rootDir, "README.md"), "utf8");
    expect(readme).toContain("openclaw plugins install @tans/openclaw-wework");
    expect(readme).toContain("openclaw plugins install --link /path/to/openclaw-wework");
    expect(readme).toContain("cp -R . ~/.openclaw/extensions/openclaw-wework");
    expect(readme).toContain("cd ~/.openclaw/extensions/openclaw-wework && npm install");
  });
});
