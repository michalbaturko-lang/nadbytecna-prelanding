// Public requests never forward arbitrary audio to an external processor.
// Approved transcription runs only in the authenticated cron worker over stored, consented audio.
import { json } from "../lib/http.js";
export default async function handler(req, res) {
  return json(res, 423, { error: "transcription_requires_approved_worker" });
}
