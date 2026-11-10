// Offline diagnostics only. Never calls Microsoft, OpenAI or the database,
// and never prints credential values. A passing result is not an OAuth test.
import { pathToFileURL } from "node:url";
import { readM365OAuthConfig } from "../lib/m365-oauth-client.mjs";
import { readM365Config } from "../lib/m365-readonly.mjs";
import { mailAiEnabled } from "../lib/mail-ai.mjs";
import { mailAiAutomationEnabled } from "../lib/mail-ai-worker.mjs";

export function mailReadiness(env = process.env) {
  const required = ["M365_AUTH_MODE", "M365_MAILBOX", "M365_TENANT_ID", "M365_CLIENT_ID",
    "M365_OAUTH_REDIRECT_URI", "M365_TOKEN_ENCRYPTION_KEY", "M365_FOLDER_ID", "M365_SINCE", "M365_CLIENT_SECRET"];
  let configurationFormatValidExceptSecret = false, configurationFormatValid = false;
  try {
    readM365OAuthConfig({ ...env, M365_CLIENT_SECRET: "offline-validation-only" });
    readM365Config(env);
    configurationFormatValidExceptSecret = true;
  } catch {}
  try { readM365OAuthConfig(env); readM365Config(env); configurationFormatValid = true; } catch {}
  return {
    offlineOnly: true,
    missingSettings: required.filter((name) => typeof env[name] !== "string" || !env[name]),
    configurationFormatValidExceptSecret,
    configurationFormatValid,
    connectEnabled: env.M365_CONNECT_ENABLED === "true",
    importEnabled: env.M365_INGEST_ENABLED === "true",
    manualAiEnabled: mailAiEnabled(env),
    automaticAiEnabled: mailAiAutomationEnabled(env),
    microsoftAuthorizationVerified: false,
    providerAnalysisVerified: false,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = mailReadiness();
  console.log(JSON.stringify(result, null, 2));
  if (!result.configurationFormatValidExceptSecret) process.exitCode = 1;
}
