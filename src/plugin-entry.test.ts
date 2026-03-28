import { describe, expect, it } from "vitest";

describe("plugin entrypoints", () => {
  it("imports the primary entry without throwing", async () => {
    const entry = await import("../index.ts");
    expect(entry.default).toBeTruthy();
  }, 20_000);

  it("imports the setup entry without throwing", async () => {
    const setupEntry = await import("../setup-entry.ts");
    expect(setupEntry.default).toBeTruthy();
  }, 20_000);
});
