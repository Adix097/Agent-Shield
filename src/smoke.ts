import { callLLM, stats } from "./llm.js";

const r = await callLLM({ contents: "Reply with exactly one word: ready" });

console.log("Model said:", r.text);
console.log(stats);
