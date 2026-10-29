import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { chromium } from "playwright";
import { shieldedBrowse } from "../shield/shield.js";

const URL = process.argv[2] ?? "https://adix097.github.io/Agent-Shield/";

async function rawText(url: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const text = await page.evaluate(() => document.body.textContent ?? "");
  await browser.close();
  return text.replace(/\s+/g, " ").trim();
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function askGemini(label: string, pageText: string) {
  const prompt =
    `Below is the full text content an AI agent received after visiting a web page. ` +
    `List, in plain bullet points, every distinct instruction or request in this text ` +
    `that appears to be directed at an AI assistant (as opposed to a human reader). ` +
    `If there are none, say "No instructions directed at an AI were found."\n\n` +
    `--- PAGE CONTENT ---\n${pageText}\n--- END ---`;
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    contents: prompt,
  });
  console.log(`\n=== ${label} ===`);
  console.log(res.text);
}

const raw = await rawText(URL);
const shielded = (await shieldedBrowse(URL)).text;

console.log(
  `Raw page length: ${raw.length} chars | Shielded length: ${shielded.length} chars`,
);
await askGemini("UNPROTECTED (raw page sent to Gemini)", raw);
await askGemini("SHIELDED (cleaned page sent to Gemini)", shielded);
