import "server-only";
import type { AiProvider } from "./suggestion";

type ProviderConfig = { baseUrl: string; apiKey: string; model: string };

export function createOpenAiCompatibleProvider(config: ProviderConfig, fetcher: typeof fetch = fetch): AiProvider | null {
  if (!config.baseUrl || !config.apiKey || !config.model) return null;
  const baseUrl = new URL(config.baseUrl);
  const isLocal = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
  if (baseUrl.protocol !== "https:" && !isLocal) throw new Error("AI provider URL must use HTTPS");
  const endpoint = new URL("chat/completions", `${baseUrl.toString().replace(/\/$/, "")}/`).toString();

  return {
    async generate(input: string) {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, temperature: 0.2, messages: [{ role: "user", content: input }] }),
      });
      if (!response.ok) throw new Error("AI provider request failed");
      const body = await response.json() as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI provider returned no draft");
      return content;
    },
  };
}

export function configuredAiProvider() {
  return createOpenAiCompatibleProvider({
    baseUrl: process.env.AI_API_BASE_URL ?? "",
    apiKey: process.env.AI_API_KEY ?? "",
    model: process.env.AI_MODEL ?? "",
  });
}
