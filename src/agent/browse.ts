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

// Plain agent's view. AGENT_VIEW=text (default): all text in the page hidden or not
// AGENT_VIEW=html: the page's full HTML including comments and attributes
export async function browseRaw(url: string): Promise<string> {
  const page = await (await getBrowser()).newPage();
  try {
    await page.goto(url);
    if ((process.env.AGENT_VIEW ?? "text") === "html") {
      return await page.content();
    }
    const text = await page.evaluate(() => document.body.textContent ?? "");
    return text.replace(/\s+/g, " ").trim();
  } finally {
    await page.close();
  }
}
