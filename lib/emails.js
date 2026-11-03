import { signUnsub } from "./tokens.js";
import { siteUrl } from "./http.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function confirmationEmail({ id, token, controllerLine }) {
  const base = siteUrl();
  const confirmUrl = `${base}/potvrzeni/?t=${encodeURIComponent(token)}`;
  const unsubUrl = `${base}/odhlaseni/?t=${encodeURIComponent(signUnsub(id))}`;
  const unsubPost = `${base}/api/unsubscribe/?t=${encodeURIComponent(signUnsub(id))}`;
  const subject = "Potvrď svůj e-mail";
  const text = [
    "Ahoj,",
    "",
    "na stránce Nadbytečná sis nechala e-mail, abys věděla, co se chystá.",
    "Potvrď prosím, že ho chceš použít:",
    confirmUrl,
    "",
    "Pokud jsi to nebyla ty, nic nedělej. Bez potvrzení ti nebudeme psát.",
    "",
    `Odhlásit se: ${unsubUrl}`,
    controllerLine ? `Správce: ${controllerLine}` : "",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  const html = `<!doctype html><html lang="cs"><body style="margin:0;background:#F4CCD8;font-family:Arial,Helvetica,sans-serif;color:#3A0B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4CCD8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFF8FA;border-radius:8px"><tr><td style="padding:32px 28px">
<p style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:#3A0B22"><strong>Potvrď svůj e-mail</strong></p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.55">Na stránce Nadbytečná sis nechala e-mail, abys věděla, co se chystá. Potvrď prosím, že ho chceš použít.</p>
<p style="margin:0 0 24px"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#B5094D;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 26px;border-radius:6px">Potvrdit e-mail</a></p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#5E2A41">Pokud jsi to nebyla ty, nic nedělej. Bez potvrzení ti nebudeme psát.</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#5E2A41"><a href="${esc(unsubUrl)}" style="color:#5E2A41">Odhlásit se</a>${controllerLine ? `<br>Správce: ${esc(controllerLine)}` : ""}</p>
</td></tr></table></td></tr></table></body></html>`;
  return {
    subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubPost}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
