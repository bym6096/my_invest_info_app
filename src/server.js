import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { providers } from "./providers/index.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

// 지표별로 실패를 격리: 하나가 죽어도 나머지는 표시된다.
export async function loadAll() {
  const results = await Promise.allSettled(providers.map((p) => p.load()));
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { id: providers[i].id, error: r.reason?.message ?? String(r.reason) },
  );
}

export function createApp() {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname === "/api/indicators") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return res.end(JSON.stringify(await loadAll()));
    }
    const rel = pathname === "/" ? "index.html" : normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    try {
      const body = await readFile(join(PUBLIC, rel));
      res.writeHead(200, { "content-type": TYPES[extname(rel)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT ?? 3000;
  createApp().listen(port, () => console.log(`http://localhost:${port}`));
}
