// Deliberate diagnostic: no network unless --probe is explicitly supplied.
// Never prints credentials, Graph identifiers, cursors, sender, subject or body.
import {
  getM365AccessToken,
  validateM365AuthConfig,
} from "../lib/m365-auth.mjs";
import { readM365DeltaPage } from "../lib/m365-readonly.mjs";
import {
  delegatedMode,
  getDelegatedMailToken,
} from "../lib/mail-oauth-service.mjs";
import { readM365OAuthConfig } from "../lib/m365-oauth-client.mjs";
try {
  if (delegatedMode()) readM365OAuthConfig(process.env);
  else validateM365AuthConfig(process.env);
  console.log(
    "Formát konfigurace připojení: platný. Přístup Microsoftu zatím neověřen.",
  );
  if (process.argv.includes("--probe")) {
    if (process.env.M365_INGEST_ENABLED !== "true") throw new Error("disabled");
    const auth = delegatedMode()
      ? await getDelegatedMailToken()
      : await getM365AccessToken();
    const page = await readM365DeltaPage({ accessToken: auth.accessToken });
    console.log(
      JSON.stringify({
        readOnlyProbe: true,
        messages: page.messages.length,
        removals: page.removals.length,
        more: Boolean(page.nextLink),
        mailMessagesPersisted: false,
        connectionCacheUpdated: delegatedMode(),
        aiCalls: 0,
      }),
    );
  }
} catch {
  console.error(
    "Kontrola neprošla. Prověřte schválenou konfiguraci a přístup; citlivé podrobnosti se nevypisují.",
  );
  process.exitCode = 1;
}
