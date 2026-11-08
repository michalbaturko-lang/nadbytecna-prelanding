import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { randomBytes, createHash } from "node:crypto";
import { streamDownload } from "../lib/admin-download.mjs";

test("large downloads preserve all bytes under slow-client backpressure", async () => {
  const payload = randomBytes(6 * 1024 * 1024 + 17);
  const hash = createHash("sha256");
  let writes = 0, largest = 0;
  const response = new Writable({
    highWaterMark: 1024,
    write(chunk, encoding, next) {
      writes++;
      largest = Math.max(largest, chunk.length);
      hash.update(chunk);
      setImmediate(next);
    },
  });
  await streamDownload(response, payload);
  assert.equal(hash.digest("hex"), createHash("sha256").update(payload).digest("hex"));
  assert.ok(writes > 90);
  assert.ok(largest <= 64 * 1024);
  assert.ok(response.writableFinished);
});

test("UTF-8 export retains BOM and Czech text", async () => {
  const chunks = [];
  const response = new Writable({ write(chunk, encoding, next) { chunks.push(chunk); next(); } });
  await streamDownload(response, "\uFEFFPříběh;Věra\r\n");
  assert.equal(Buffer.concat(chunks).toString("utf8"), "\uFEFFPříběh;Věra\r\n");
});

test("disconnected download stops rather than continuing or hanging", async () => {
  let writes = 0;
  const response = new Writable({
    write(chunk, encoding, next) {
      writes++;
      this.destroy(new Error("synthetic disconnect"));
      next();
    },
  });
  await assert.rejects(streamDownload(response, Buffer.alloc(6 * 1024 * 1024)), /synthetic disconnect/);
  assert.equal(writes, 1);
});
