import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../server.mjs";
test("local server serves app, rejects cross-origin calls and malformed requests", async () => {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Hebrew Subtitle Studio/);
    assert.match(
      response.headers.get("content-security-policy"),
      /connect-src 'self'/,
    );
    assert.equal(
      (
        await fetch(base + "/api/status", {
          headers: { Origin: "https://example.com" },
        })
      ).status,
      403,
    );
    const spoofedStatus = await new Promise((resolve, reject) => {
      http
        .get(
          base + "/api/status",
          { headers: { Host: "evil.example:4318" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        )
        .on("error", reject);
    });
    assert.equal(spoofedStatus, 403);
    assert.equal(
      (
        await fetch(base + "/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "bad" }),
        })
      ).status,
      400,
    );
    assert.equal((await fetch(base + "/package.json")).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
