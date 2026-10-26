import { startServer } from "./server.js";
import { ATTACKS } from "./pages.js";
import { browseRaw, closeBrowser } from "../agent/browse.js";

const server = await startServer();
const ids: (string | undefined)[] = [undefined, ...ATTACKS.map((a) => a.id)];

for (const id of ids) {
  const url = "http://localhost:4000/flights" + (id ? `?attack=${id}` : "");
  const text = await browseRaw(url);
  const seen = text.includes("attacker@evil.test");
  console.log(
    `${(id ?? "clean page").padEnd(20)} plain agent sees the attack: ${seen}`,
  );
}

await closeBrowser();
server.close();
