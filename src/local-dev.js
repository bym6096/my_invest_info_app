import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getIndicator, listIndicators } from "./api.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };

export function createApp() {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url, "http://x");
    if (pathname.startsWith("/api/indicators")) {
      const id = pathname.split("/")[3];
      const { status, headers, body } = id ? await getIndicator(id) : listIndicators();
      res.writeHead(status, headers);
      return res.end(JSON.stringify(body));
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
