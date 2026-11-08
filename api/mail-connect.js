import crypto from "node:crypto";
import { json } from "../lib/http.js";
import { readBody, fail } from "../lib/admin-server.mjs";
import { MAILBOX } from "../lib/mail-service.mjs";
import {
  oauthRpc,
  oauthHash,
  oauthReadiness,
} from "../lib/mail-oauth-service.mjs";
import {
  readM365OAuthConfig,
  getAuthUrl,
  exchangeCode,
  encryptM365Cache,
  decryptM365Cache,
} from "../lib/m365-oauth-client.mjs";
import { readM365Json } from "../lib/m365-readonly.mjs";
import { mailConnectHtml } from "../lib/mail-connect-html.mjs";

const FLOW_COOKIE = "__Host-nb-mail-flow",
  RESULT_COOKIE = "__Host-nb-mail-result";
const opaque = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);
function cookie(req, name) {
  const values = String(req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + "="));
  return values.length === 1 ? values[0].slice(name.length + 1) : "";
}
const setCookie = (name, value, age) =>
  `${name}=${value}; Path=/; Max-Age=${age}; Secure; HttpOnly; SameSite=Lax`;
const key = () =>
  Buffer.from(process.env.M365_TOKEN_ENCRYPTION_KEY || "", "base64");
function resultCookie(outcome) {
  const payload = Buffer.from(
    JSON.stringify({ outcome, exp: Date.now() + 120000 }),
  ).toString("base64url");
  return (
    payload +
    "." +
    crypto.createHmac("sha256", key()).update(payload).digest("base64url")
  );
}
function resultOf(req) {
  try {
    const value = cookie(req, RESULT_COOKIE);
    if (value.length > 600) return "invalid";
    const [p, s] = value.split(".");
    const a = Buffer.from(s || "", "base64url"),
      b = crypto.createHmac("sha256", key()).update(p).digest();
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return "invalid";
    const d = JSON.parse(Buffer.from(p, "base64url"));
    return d.exp > Date.now() ? d.outcome : "invalid";
  } catch {
    return "invalid";
  }
}
const messages = {
  connected:
    "Schránka byla připojena. Načítání pošty a případné AI zpracování spravuje provozovatel odděleně.",
  denied:
    "Připojení nebylo schváleno. Pokud Microsoft požaduje správce organizace, požádejte jej o schválení aplikace a potom o novou pozvánku.",
  wrong_account:
    "Přihlášený účet neodpovídá schránce veryvera@nadbytecna.cz nebo očekávané organizaci. Nic nebylo připojeno. Požádejte o nový odkaz a vyberte správný účet.",
  failed:
    "Připojení se nepodařilo dokončit. Nic nebylo nově připojeno. Požádejte o nový odkaz.",
  invalid:
    "Toto potvrzení není platné nebo už vypršelo. Stav připojení ověřte u provozovatele.",
};
function html(res, status, options) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.end(mailConnectHtml(options));
}
function redirectResult(res, c, outcome) {
  res.setHeader("Set-Cookie", [
    setCookie(FLOW_COOKIE, "", 0),
    setCookie(RESULT_COOKIE, resultCookie(outcome), 120),
  ]);
  res.statusCode = 303;
  res.setHeader(
    "Location",
    new URL("/api/mail-connect/?step=result", c.redirectUri).href,
  );
  return res.end();
}
export function createMailConnectHandler({
  authUrl = getAuthUrl,
  exchange = exchangeCode,
  store = oauthRpc,
  fetcher = (...a) => fetch(...a),
} = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    const url = new URL(
        req.url || "/api/mail-connect/",
        "https://nadbytecna.cz",
      ),
      step = url.searchParams.get("step") || "landing";
    if (req.method === "GET" && step === "landing")
      return html(res, 200, { ready: oauthReadiness().connectInviteEnabled });
    if (req.method === "GET" && step === "result") {
      if (!oauthReadiness().connectConfigured)
        return html(res, 503, {
          result: true,
          message: "Připojení Microsoftu ještě není nastavené.",
        });
      const outcome = resultOf(req);
      res.setHeader("Set-Cookie", setCookie(RESULT_COOKIE, "", 0));
      return html(res, 200, {
        result: true,
        message: messages[outcome] || messages.invalid,
      });
    }
    if (!oauthReadiness().connectInviteEnabled)
      return html(res, 503, {
        result: true,
        message:
          "Připojení Microsoftu ještě není nastavené nebo je dočasně vypnuté.",
      });
    const c = readM365OAuthConfig(process.env);
    if (req.method === "POST" && step === "begin")
      try {
        if (req.headers.origin !== new URL(c.redirectUri).origin)
          throw fail(403, "origin");
        if (
          !String(req.headers["content-type"] || "")
            .toLowerCase()
            .startsWith("application/json")
        )
          throw fail(415, "type");
        const body = await readBody(req);
        if (!opaque(body.invite)) throw fail(400, "invitation");
        const state = crypto.randomBytes(32).toString("base64url"),
          proof = crypto.randomBytes(32).toString("base64url"),
          verifier = crypto.randomBytes(48).toString("base64url");
        const attempt = await store("begin", {
          token_hash: oauthHash(body.invite),
          state_hash: oauthHash(state),
          cookie_hash: oauthHash(proof),
          encrypted_flow: encryptM365Cache({
            cache: JSON.stringify({ verifier }),
            context: "oauth-flow",
          }),
        });
        if (
          !attempt ||
          attempt.mailbox !== MAILBOX ||
          attempt.tenant_id !== c.tenantId
        )
          throw fail(400, "invitation");
        const out = await authUrl({
          state,
          codeChallenge: crypto
            .createHash("sha256")
            .update(verifier)
            .digest("base64url"),
        });
        const target = new URL(out.url);
        if (
          target.origin !== "https://login.microsoftonline.com" ||
          target.pathname !== `/${c.tenantId}/oauth2/v2.0/authorize`
        )
          throw fail(503, "authorization");
        res.setHeader("Set-Cookie", setCookie(FLOW_COOKIE, proof, 600));
        return json(res, 200, { url: target.href });
      } catch (e) {
        return json(res, e.status || 503, {
          error: e.code || "mail_connect_failed",
        });
      }
    if (req.method === "GET" && step === "callback")
      try {
        const state = url.searchParams.get("state"),
          proof = cookie(req, FLOW_COOKIE);
        if (!opaque(state) || !opaque(proof))
          return redirectResult(res, c, "failed");
        const attempt = await store("callback_claim", {
          state_hash: oauthHash(state),
          cookie_hash: oauthHash(proof),
        });
        if (
          !attempt ||
          attempt.mailbox !== MAILBOX ||
          attempt.tenant_id !== c.tenantId
        )
          return redirectResult(res, c, "failed");
        if (url.searchParams.has("error"))
          return redirectResult(
            res,
            c,
            url.searchParams.get("error") === "access_denied"
              ? "denied"
              : "failed",
          );
        const code = url.searchParams.get("code");
        if (!code || code.length > 8192)
          return redirectResult(res, c, "failed");
        const flow = JSON.parse(
          decryptM365Cache({
            encrypted: attempt.encrypted_flow,
            context: "oauth-flow",
          }),
        );
        const token = await exchange({ code, codeVerifier: flow.verifier });
        if (!token.enabled || token.tenantId !== c.tenantId)
          return redirectResult(res, c, "wrong_account");
        // Verify the actual Graph resource owner, not a login_hint or editable profile text.
        const r = await fetcher(
          "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName",
          {
            method: "GET",
            redirect: "error",
            cache: "no-store",
            headers: {
              Authorization: "Bearer " + token.accessToken,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!r.ok || r.redirected)
          return redirectResult(res, c, "wrong_account");
        const me = await readM365Json(r, 16384);
        if (
          !me.id ||
          ![me.mail, me.userPrincipalName].some(
            (v) => typeof v === "string" && v.toLowerCase() === MAILBOX,
          )
        )
          return redirectResult(res, c, "wrong_account");
        const folder = await fetcher(
          "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id",
          {
            method: "GET",
            redirect: "error",
            cache: "no-store",
            headers: {
              Authorization: "Bearer " + token.accessToken,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(10000),
          },
        );
        if (
          !folder.ok ||
          folder.redirected ||
          !(await readM365Json(folder, 16384)).id
        )
          return redirectResult(res, c, "failed");
        const saved = await store("save_connection", {
          attempt_id: attempt.attempt_id,
          account_id: token.accountId,
          tenant_id: token.tenantId,
          mailbox: MAILBOX,
          ciphertext: encryptM365Cache({
            cache: token.cache,
            context: "oauth-cache",
          }),
        });
        return redirectResult(res, c, saved.saved ? "connected" : "failed");
      } catch {
        return redirectResult(res, c, "failed");
      }
    return json(res, 405, { error: "method" });
  };
}
export default createMailConnectHandler();
