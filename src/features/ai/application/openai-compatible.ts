import "server-only";
import type { AiProvider } from "./suggestion";

type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

async function readBoundedResponse(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error("AI provider response too large");

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("AI provider response too large");
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("AI provider response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function createOpenAiCompatibleProvider(config: ProviderConfig, fetcher: typeof fetch = fetch): AiProvider | null {
  if (!config.baseUrl || !config.apiKey || !config.model) return null;
  const baseUrl = new URL(config.baseUrl);
  const isLocal = baseUrl.hostname === "localhost" || baseUrl.hostname === "127.0.0.1";
  if (baseUrl.protocol !== "https:" && !isLocal) throw new Error("AI provider URL must use HTTPS");
  const endpoint = new URL("chat/completions", `${baseUrl.toString().replace(/\/$/, "")}/`).toString();
  const timeoutMs = Math.max(1, Math.min(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, 120_000));
  const maxResponseBytes = Math.max(1, Math.min(config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 5_000_000));

  return {
    async generate(input: string) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          cache: "no-store",
          signal: controller.signal,
          headers: { "content-type": "application/json", Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ model: config.model, temperature: 0.2, messages: [{ role: "user", content: input }] }),
        });
        if (!response.ok) throw new Error("AI provider request failed");
        const body = JSON.parse(await readBoundedResponse(response, maxResponseBytes)) as { choices?: { message?: { content?: string } }[] };
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error("AI provider returned no draft");
        return content;
      } catch (error) {
        if (controller.signal.aborted) throw new Error("AI provider request timed out");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
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
