import { describe, expect, it, vi } from "vitest";
import { createOpenAiCompatibleProvider } from "./openai-compatible";

describe("OpenAI-compatible provider", () => {
  it("is unavailable until all server-side provider settings are configured", () => {
    expect(createOpenAiCompatibleProvider({ baseUrl: "", apiKey: "", model: "" })).toBeNull();
  });

  it("calls the configured server-side endpoint without exposing credentials in the request body", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"explanation":"Explain","recommendedAction":"Review","confidence":"low","sourceReferences":[]}' } }] }), { status: 200 }));
    const provider = createOpenAiCompatibleProvider({ baseUrl: "https://model.example/v1", apiKey: ["server", "secret"].join("-"), model: "drafting-model" }, fetcher);

    await expect(provider?.generate("draft this safely")).resolves.toContain("recommendedAction");
    expect(fetcher).toHaveBeenCalledWith("https://model.example/v1/chat/completions", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer server-secret" }),
      body: expect.not.stringContaining("server-secret"),
    }));
  });
});
