import http from "node:http";
import { renderPage } from "./pages.js";

export function startServer(port = 4000): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/flights") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        renderPage(
          url.searchParams.get("attack") ?? undefined,
          url.searchParams.get("payload") ?? undefined,
        ),
      );
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
