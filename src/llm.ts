import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
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

let ai: GoogleGenAI | undefined;
function client() {
  if (!ai) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY missing in .env");
    }
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  return ai;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let chain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => undefined);
  return run;
}

function isRetryable(err: unknown) {
  const msg = String((err as any)?.message ?? err);
  if (/PerDay/i.test(msg)) return false; // daily quota: retrying won't help

  return /429|500|503|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|overloaded/i.test(
    msg,
  );
}

// `variant` repeat the same prompt on purpose (e.g. run 1, 2, 3)
// without the cache returning the identical answer each time.
export async function callLLM(params: {
  contents: unknown;
  config?: Record<string, unknown>;
  variant?: number;
}): Promise<LLMResult> {
  if (!MODEL) throw new Error("GEMINI_MODEL missing in .env");

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
        const res = await client().models.generateContent({
          model: MODEL,
          contents: params.contents as any,
          config: params.config as any,
        });
        lastCallAt = Date.now();
        stats.liveCalls++;
        const parts: any[] = res.candidates?.[0]?.content?.parts ?? [];

        const out: LLMResult = {
          text: parts.map((p) => p.text ?? "").join(""),
          functionCalls: parts
            .filter((p) => p.functionCall)
            .map((p) => p.functionCall),
          content: res.candidates?.[0]?.content ?? null,
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
