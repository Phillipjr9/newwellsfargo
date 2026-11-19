import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { adminApi, demoApi } from "./api.mjs";
import { publicPageApi } from "./public-pages.mjs";

const root = new URL("../dist/", import.meta.url);
const server = createServer((req, res) =>
  publicPageApi(req, res, () => adminApi(req, res, () => demoApi(req, res, async () => {
    const path = (req.url || "/").split("?")[0];
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      if (path.startsWith("/api/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (path !== "/index.html" && /\.[a-z0-9]{2,5}$/i.test(path)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const file = new URL("index.html", root);
      const body = await readFile(fileURLToPath(file));
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(503);
      res.end("Run npm run build before starting the demo.");
    }
  }))),
);
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "0.0.0.0",
  () => console.log(`Banking demo listening on port ${server.address().port}`),
);
