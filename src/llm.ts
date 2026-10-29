import "dotenv/config";
import { GoogleGenAI, type ContentListUnion } from "@google/genai";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const MODEL = process.env.GEMINI_MODEL;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

function isRetryable(err: unknown) {
  const msg = String((err as { message?: unknown })?.message ?? err);
  return /429|500|503|overloaded/i.test(msg) && !/daily.?quota.?exceeded/i.test(msg);
}

function extractResponse(response: {
  functionCalls?: { name?: string; args?: Record<string, unknown> }[];
  text?: string;
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }[];
    };
  }[];
}) {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const functionCalls =
    response.functionCalls ??
    parts
      .map((part) => part.functionCall)
      .filter(
        (call): call is { name?: string; args?: Record<string, unknown> } =>
          call !== undefined,
      );
  const text =
    response.text ??
    parts
      .map((part) => part.text)
      .filter((part): part is string => part !== undefined)
      .join("");

  return { text, functionCalls };
}

// `variant` repeats the same prompt on purpose without returning the cached answer.
export async function callLLM(params: {
  contents: unknown;
  config?: Record<string, unknown>;
  variant?: number;
}): Promise<LLMResult> {
  if (!MODEL) throw new Error("GEMINI_MODEL missing in .env");

  const key = createHash("sha256")
    .update(JSON.stringify({ model: MODEL, ...params }))
    .digest("hex")
    .slice(0, 24);
  const file = `${CACHE_DIR}/${key}.json`;

  try {
    const hit = JSON.parse(await readFile(file, "utf8")) as LLMResult;
    stats.cacheHits++;
    return hit;
  } catch {
    // A missing or unreadable cache entry is handled by live/replay mode below.
  }

  if (MODE === "replay") {
    throw new Error("replay mode: no recorded response for this call");
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing in .env");
  }

  return enqueue(async () => {
    try {
      const hit = JSON.parse(await readFile(file, "utf8")) as LLMResult;
      stats.cacheHits++;
      return hit;
    } catch {
      // Another queued call may have populated the cache; continue to Gemini.
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    for (let attempt = 0; ; attempt++) {
      const wait = lastCallAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try {
        const response = await ai.models.generateContent({
          model: MODEL,
          contents: params.contents as ContentListUnion,
          config: params.config,
        });
        lastCallAt = Date.now();
        stats.liveCalls++;
        const extracted = extractResponse(response);
        const out: LLMResult = {
          text: extracted.text,
          functionCalls: extracted.functionCalls,
          content: response.candidates?.[0]?.content ?? response,
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
