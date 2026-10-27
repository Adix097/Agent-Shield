import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const MODEL = process.env.OLLAMA_MODEL;
const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(
  /\/$/,
  "",
);
const MODE = process.env.LLM_MODE ?? "live";
const MIN_GAP_MS = Number(process.env.LLM_MIN_GAP_MS ?? 4000);
const MAX_RETRIES = 6;
const CACHE_DIR = "results/cache";

export const stats = { liveCalls: 0, cacheHits: 0, retries: 0 };

export type LLMResult = {
  text: string;
  functionCalls: { name?: string; args?: Record<string, unknown> }[];
  content: unknown;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

function isRetryable(err: unknown) {
  const msg = String((err as { message?: unknown })?.message ?? err);

  return /429|500|502|503|504|overloaded|timed out|fetch failed/i.test(msg);
}

function toOllamaMessages(contents: unknown) {
  if (typeof contents === "string") {
    return [{ role: "user", content: contents }];
  }

  if (!Array.isArray(contents)) return contents;

  return contents.map((message) => {
    if (!message || typeof message !== "object") return message;
    const item = message as Record<string, unknown>;
    if (item.role === "tool") return item;
    if (typeof item.content === "string") {
      return item;
    }

    const parts = Array.isArray(item.parts) ? item.parts : [];
    const text = parts
      .filter(
        (part): part is { text: string } =>
          !!part &&
          typeof part === "object" &&
          typeof (part as Record<string, unknown>).text === "string",
      )
      .map((part) => part.text)
      .join("");

    return { role: item.role, content: text };
  });
}

// `variant` repeat the same prompt on purpose (e.g. run 1, 2, 3)
// without the cache returning the identical answer each time.
export async function callLLM(params: {
  contents: unknown;
  config?: Record<string, unknown>;
  variant?: number;
}): Promise<LLMResult> {
  if (!MODEL) throw new Error("OLLAMA_MODEL missing in .env");

  const key = createHash("sha256")
    .update(JSON.stringify({ MODEL, ...params }))
    .digest("hex")
    .slice(0, 24);
  const file = `${CACHE_DIR}/${key}.json`;

  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as LLMResult;
    stats.cacheHits++;
    return hit;
  } catch {}

  if (MODE === "replay") {
    throw new Error("replay mode: no recorded response for this call");
  }

  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCallAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const config = params.config ?? {};
        const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            messages: toOllamaMessages(params.contents),
            stream: false,
            ...(typeof config.systemInstruction === "string"
              ? { system: config.systemInstruction }
              : {}),
            ...(Array.isArray(config.tools) ? { tools: config.tools } : {}),
          }),
        });
        if (!response.ok) {
          throw new Error(
            `Ollama request failed (${response.status}): ${await response.text()}`,
          );
        }
        const res = (await response.json()) as {
          message?: {
            role?: string;
            content?: string;
            tool_calls?: {
              function?: { name?: string; arguments?: Record<string, unknown> };
            }[];
          };
        };
        lastCallAt = Date.now();
        stats.liveCalls++;
        const message = res.message ?? {};
        const functionCalls = (message.tool_calls ?? []).map((call) => ({
          name: call.function?.name,
          args: call.function?.arguments ?? {},
        }));

        const out: LLMResult = {
          text: message.content ?? "",
          functionCalls,
          content: message,
        };
        
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(file, JSON.stringify(out, null, 2));
        return out;
      } catch (err) {
        lastCallAt = Date.now();
        if (!isRetryable(err) || attempt >= MAX_RETRIES) throw err;
        stats.retries++;
        const backoff =
          Math.min(60000, 2000 * 2 ** attempt) + Math.random() * 1000;
        console.warn(
          `LLM error (attempt ${attempt + 1}), retrying in ${Math.round(backoff / 1000)}s`,
        );
        await sleep(backoff);
      }
    }
  });
}
