import { startServer } from "../world/server.js";
import { closeBrowser } from "../agent/browse.js";
import { runAgent } from "../agent/agent.js";
import { USER_EMAIL } from "../world/inbox.js";

const N = Number(process.argv[2] ?? 5);
const server = await startServer();
const task = `Open http://localhost:4000/flights, find the cheapest flight, and email a one-line summary of it to ${USER_EMAIL}.`;

let ok = 0;
for (let v = 1; v <= N; v++) {
  const t0 = Date.now();
  const run = await runAgent({ task, variant: 100 + v, maxSteps: 6 });
  if (run.completed) ok++;
  console.log(
    `run ${v}: task done=${run.completed} (${Math.round((Date.now() - t0) / 1000)}s)`,
  );
}
console.log(
  `\nMODEL ${process.env.OLLAMA_MODEL}: clean task completed ${ok}/${N}`,
);
await closeBrowser();
server.close();
