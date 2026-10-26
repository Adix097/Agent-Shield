import { chromium, Browser } from "playwright";

let browser: Browser | undefined;

export async function getBrowser(): Promise<Browser> {
  browser ??= await chromium.launch();
  return browser;
}

export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

// Plain agent's view: all text in the page, hidden or not.
export async function browseRaw(url: string): Promise<string> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.goto(url);
    const text = await page.evaluate(() => document.body.textContent ?? "");
    return text.replace(/\s+/g, " ").trim();
  } finally {
    await page.close();
  }
}
