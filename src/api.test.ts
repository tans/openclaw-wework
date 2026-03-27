import { describe, expect, it, vi } from "vitest";
import { requestWeworkCdnDownload } from "./api.js";

describe("requestWeworkCdnDownload", () => {
  it("posts directly to the configured bridge when baseUrl is provided", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await requestWeworkCdnDownload({
      accountId: "default",
      baseUrl: "http://127.0.0.1:6255",
      fetcher,
      type: 11170,
      payload: { file_id: "file-1", save_path: "/tmp/test.jpg" },
      timeoutMs: 5000,
    });

    expect(result).toEqual({ success: true });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:6255/message",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 11170,
          data: { file_id: "file-1", save_path: "/tmp/test.jpg" },
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
