import { rpc, restPath, supa } from "../lib/admin-server.mjs";
import { createMailAiWorkerHandler, runMailAiWorker } from "../lib/mail-ai-worker.mjs";

export default createMailAiWorkerHandler({
  run: (env) => runMailAiWorker({
    env,
    rpc,
    loadCategories: async () => {
      const rows = await supa(restPath("categories", { select: "code", active: "eq.true" }));
      return rows.map((row) => row.code);
    },
  }),
});
