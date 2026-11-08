// Server-only certificate client_credentials. No discovery, browser flow, secrets logging or persistent cache.
import { createPrivateKey, randomUUID, sign, constants } from "node:crypto";
import {
  m365Enabled,
  readM365Config,
  readM365Json,
  m365Error,
} from "./m365-readonly.mjs";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parsedAuthConfig(env) {
  const scope = readM365Config(env);
  const tenant = env.M365_TENANT_ID,
    client = env.M365_CLIENT_ID,
    thumbprint = env.M365_CERT_SHA256_THUMBPRINT,
    pem = env.M365_CERT_PRIVATE_KEY;
  if (
    !GUID.test(tenant || "") ||
    !GUID.test(client || "") ||
    !/^[a-f0-9]{64}$/i.test(thumbprint || "") ||
    typeof pem !== "string" ||
    pem.length > 32768
  )
    throw m365Error("invalid_configuration");
  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
    if (
      privateKey.asymmetricKeyType !== "rsa" ||
      privateKey.asymmetricKeyDetails.modulusLength < 2048
    )
      throw new Error();
  } catch {
    throw m365Error("invalid_configuration");
  }
  return { scope, tenant, client, thumbprint, privateKey };
}
// Explicit validation for truthful status. Does not require the ingestion flag and never signs or calls a service.
export function validateM365AuthConfig(env = process.env) {
  const { scope, tenant, client } = parsedAuthConfig(env);
  return {
    ...scope,
    tenantId: tenant,
    clientId: client,
    credentialType: "certificate",
  };
}
export async function getM365AccessToken({
  env = process.env,
  fetcher = fetch,
  now = Date.now,
} = {}) {
  if (!m365Enabled(env)) return { enabled: false, accessToken: null };
  if (typeof fetcher !== "function") throw m365Error("invalid_configuration");
  const { tenant, client, thumbprint, privateKey: key } = parsedAuthConfig(env);
  const endpoint =
    "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token";
  let assertion;
  try {
    const timestamp = Math.floor(now() / 1000);
    if (!Number.isFinite(timestamp)) throw new Error();
    const header = Buffer.from(
      JSON.stringify({
        alg: "PS256",
        typ: "JWT",
        "x5t#S256": Buffer.from(thumbprint, "hex").toString("base64url"),
      }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        aud: endpoint,
        iss: client,
        sub: client,
        jti: randomUUID(),
        iat: timestamp,
        nbf: timestamp - 30,
        exp: timestamp + 300,
      }),
    ).toString("base64url");
    const input = header + "." + payload;
    assertion =
      input +
      "." +
      sign("sha256", Buffer.from(input), {
        key,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      }).toString("base64url");
  } catch {
    throw m365Error("invalid_configuration");
  }
  const body = new URLSearchParams({
    client_id: client,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
    client_assertion_type:
      "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  });
  let response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw m365Error(
      e?.name === "TimeoutError" || e?.name === "AbortError"
        ? "timeout"
        : "token_request_failed",
    );
  }
  if (response.status !== 200 || response.redirected)
    throw m365Error("token_request_failed");
  let data;
  try {
    data = await readM365Json(response, 65536);
  } catch {
    throw m365Error("invalid_token_response");
  }
  if (
    data.token_type !== "Bearer" ||
    typeof data.access_token !== "string" ||
    !data.access_token ||
    data.access_token.length > 16384 ||
    /\s/.test(data.access_token) ||
    !Number.isInteger(data.expires_in) ||
    data.expires_in < 1 ||
    data.expires_in > 86400
  )
    throw m365Error("invalid_token_response");
  return {
    enabled: true,
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}
