// Deliberate diagnostic: no network unless --probe is explicitly supplied.
// Never prints credentials, Graph identifiers, cursors, sender, subject or body.
import {
  getM365AccessToken,
  validateM365AuthConfig,
} from "../lib/m365-auth.mjs";
import { readM365DeltaPage } from "../lib/m365-readonly.mjs";
try {
  validateM365AuthConfig(process.env);
  console.log(
    "Konfigurace schránky a certifikátu: platná. Přístup Microsoftu zatím neověřen.",
  );
  if (process.argv.includes("--probe")) {
    if (process.env.M365_INGEST_ENABLED !== "true") throw new Error("disabled");
    const auth = await getM365AccessToken();
    const page = await readM365DeltaPage({ accessToken: auth.accessToken });
    console.log(
      JSON.stringify({
        readOnlyProbe: true,
        messages: page.messages.length,
        removals: page.removals.length,
        more: Boolean(page.nextLink),
        persisted: false,
        aiCalls: 0,
      }),
    );
  }
} catch {
  console.error(
    "Kontrola neprošla. Prověřte schválenou konfiguraci, certifikát a oprávnění; citlivé podrobnosti se nevypisují.",
  );
  process.exitCode = 1;
}
