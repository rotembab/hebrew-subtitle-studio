import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseSubtitles } from "./lib/subtitles.mjs";
import { ollamaStatus, translateDocument } from "./lib/translator.mjs";

const files = {
  "/": ["public/index.html", "text/html"],
  "/app.js": ["public/app.js", "text/javascript"],
  "/style.css": ["public/style.css", "text/css"],
  "/subtitles.mjs": ["lib/subtitles.mjs", "text/javascript"],
  "/example.srt": ["examples/idioms.srt", "text/plain"],
};
const root = fileURLToPath(new URL(".", import.meta.url));

async function readJson(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new Error("Expected JSON.");
  const parts = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8 * 1024 * 1024)
      throw new Error("File is too large. Maximum request size is 8 MB.");
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}

export function createApp() {
  let busy = false;
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const authority = req.headers.host ?? "";
    if (
      !/^(127\.0\.0\.1|localhost):\d+$/.test(authority) ||
      (req.headers.origin && req.headers.origin !== `http://${authority}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403).end("Local access only.");
      return;
    }
    const pathname = new URL(req.url, `http://${authority}`).pathname;
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.method === "GET" && pathname === "/api/status") {
        json(200, { app: "hebrew-subtitle-studio", ...(await ollamaStatus()) });
        return;
      }
      if (req.method === "POST" && pathname === "/api/translate") {
        if (busy) {
          json(409, {
            error:
              "Another translation is running. Stop it or wait for it to finish.",
          });
          return;
        }
        const body = await readJson(req);
        const document = parseSubtitles(body.source);
        const options =
          body.options && typeof body.options === "object" ? body.options : {};
        if (busy) {
          json(409, {
            error:
              "Another translation is running. Stop it or wait for it to finish.",
          });
          return;
        }
        const abort = new AbortController();
        res.on("close", () => abort.abort());
        busy = true;
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
        });
        res.flushHeaders();
        const send = (event) => {
          if (!res.destroyed) res.write(JSON.stringify(event) + "\n");
        };
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 15000);
        try {
          await translateDocument(document, options, send, abort.signal);
        } catch (error) {
          if (!abort.signal.aborted)
            send({ type: "error", message: error.message });
        } finally {
          clearInterval(heartbeat);
          busy = false;
          res.end();
        }
        return;
      }
      if (req.method === "GET" && files[pathname]) {
        const [file, type] = files[pathname];
        const content = await readFile(resolve(root, file));
        res
          .writeHead(200, { "Content-Type": `${type}; charset=utf-8` })
          .end(content);
        return;
      }
      json(404, { error: "Not found." });
    } catch (error) {
      if (!res.headersSent) json(400, { error: error.message });
      else res.end();
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT || 4318);
  const app = createApp();
  app.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${port} is already in use. The app may already be running: http://127.0.0.1:${port}`
        : error.message,
    );
    process.exitCode = 1;
  });
  app.listen(port, "127.0.0.1", () =>
    console.log(`Hebrew Subtitle Studio is ready at http://127.0.0.1:${port}`),
  );
}
