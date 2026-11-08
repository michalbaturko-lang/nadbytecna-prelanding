import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Explicit writes select streaming on Vercel instead of a buffered response
// (limited to 4.5 MB). Prepare and audit the complete export before calling.
// pipeline respects backpressure and stops when the client disconnects.
export async function streamDownload(res, payload) {
  const bytes = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  async function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024)
      yield bytes.subarray(offset, offset + 64 * 1024);
  }
  await pipeline(Readable.from(chunks()), res);
}
