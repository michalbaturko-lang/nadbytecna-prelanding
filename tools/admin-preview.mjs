// Local-only synthetic review server. This file is never a Vercel API entry point.
import { startAdminServer } from "../tests/helpers/admin-server.mjs";
const s = await startAdminServer({ port: 4477, autoLogin: true });
console.log("Syntetický lokální náhled: " + s.url + "/admin/?sort=urgency");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await s.close();
    process.exit(0);
  });
