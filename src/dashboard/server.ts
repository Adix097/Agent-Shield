import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DASHBOARD_DIR = path.join(ROOT, "dashboard", "dist");
const RESULTS_DIR = path.join(ROOT, "results");
const PROGRESS_PREFIX = "__AGENT_SHIELD_PROGRESS__";

const evaluations = {
  "shield-eval": {
    script: "src/shield/eval.ts",
    total: 96,
  },
  baseline: {
    script: "src/shield/baseline.ts",
    total: 96,
  },
  "gate-eval": {
    script: "src/shield/gate-eval.ts",
    total: 9,
  },
} as const;

type EvaluationName = keyof typeof evaluations;

const resultFiles = {
  summary: "summary.json",
  shieldEval: "shield-eval.json",
  baselineEval: "baseline-eval.json",
  gateEval: "gate-eval.json",
} as const;

async function readJsonFile(fileName: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path.join(RESULTS_DIR, fileName), "utf8"));
  } catch {
    return null;
  }
}

async function loadResults() {
  const entries = await Promise.all(
    Object.entries(resultFiles).map(async ([key, fileName]) => [
      key,
      await readJsonFile(fileName),
    ]),
  );
  const result = Object.fromEntries(entries);
  return Object.values(result).some((value) => value !== null) ? result : null;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

function sendEvent(
  res: http.ServerResponse,
  event: "progress" | "done" | "error",
  data: unknown,
) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function contentType(filePath: string) {
  const extension = path.extname(filePath);
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".html": "text/html; charset=utf-8",
    }[extension] ?? "application/octet-stream"
  );
}

function serveDashboard(req: http.IncomingMessage, res: http.ServerResponse) {
  const requestedPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.slice(1);
  const filePath = path.resolve(DASHBOARD_DIR, relativePath);

  if (!filePath.startsWith(DASHBOARD_DIR + path.sep)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  access(filePath)
    .then(() => {
      res.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-type": contentType(filePath),
      });
      createReadStream(filePath).pipe(res);
    })
    .catch(() => sendJson(res, 404, { error: "not found" }));
}

function runEvaluation(name: EvaluationName, res: http.ServerResponse) {
  const evaluation = evaluations[name];
  const child = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), evaluation.script],
    {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  let errorOutput = "";
  let lastProgress = 0;

  const handleOutput = (chunk: Buffer) => {
    output += chunk.toString();
    const lines = output.split(/\r?\n/);
    output = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith(PROGRESS_PREFIX)) continue;
      try {
        const progress = JSON.parse(line.slice(PROGRESS_PREFIX.length));
        lastProgress = progress.done;
        sendEvent(res, "progress", progress);
      } catch {
        // Ignore malformed progress lines; the process result remains authoritative.
      }
    }
  };

  child.stdout.on("data", handleOutput);
  child.stderr.on("data", (chunk: Buffer) => {
    errorOutput += chunk.toString();
  });
  child.on("error", (error) => {
    sendEvent(res, "error", { message: error.message });
    res.end();
  });
  child.on("close", async (code) => {
    if (code !== 0) {
      sendEvent(res, "error", {
        message:
          errorOutput.trim() ||
          `Evaluation failed with exit code ${code ?? "unknown"}.`,
      });
      res.end();
      return;
    }

    if (lastProgress < evaluation.total) {
      sendEvent(res, "progress", {
        done: evaluation.total,
        total: evaluation.total,
        label: "Finishing and saving results",
      });
    }
    sendEvent(res, "done", await loadResults());
    res.end();
  });
}

export function startDashboardServer(port = 5001): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (req.method === "GET" && url.pathname === "/api/results") {
      loadResults()
        .then((results) => sendJson(res, 200, results))
        .catch((error: Error) => sendJson(res, 500, { error: error.message }));
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/run/")) {
      const name = url.pathname.slice("/api/run/".length) as EvaluationName;
      if (!(name in evaluations)) {
        sendJson(res, 404, { error: "unknown evaluation" });
        return;
      }
      res.writeHead(200, {
        "access-control-allow-origin": "*",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream; charset=utf-8",
      });
      res.write("retry: 1000\n\n");
      runEvaluation(name, res);
      return;
    }

    if (req.method === "GET") {
      serveDashboard(req, res);
      return;
    }

    sendJson(res, 405, { error: "method not allowed" });
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

const server = await startDashboardServer();
console.log(`Agent Shield dashboard running at http://localhost:${(server.address() as { port: number }).port}`);
