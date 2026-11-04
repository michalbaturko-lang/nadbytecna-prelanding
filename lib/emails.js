import { signUnsub } from "./tokens.js";
import { siteUrl } from "./http.js";
import { PATHS } from "./consent.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const T = {
  cs: {
    subject: "Potvrď svůj e-mail",
    hello: "Ahoj,",
    intro: "na stránce Nadbytečná sis nechala e-mail, abys věděla, co se chystá.",
    ask: "Potvrď prosím, že ho chceš použít:",
    ignore: "Pokud jsi to nebyla ty, nic nedělej. Bez potvrzení ti nebudeme psát.",
    unsub: "Odhlásit se",
    controller: "Správce",
    htmlIntro: "Na stránce Nadbytečná sis nechala e-mail, abys věděla, co se chystá. Potvrď prosím, že ho chceš použít.",
    button: "Potvrdit e-mail",
  },
  sk: {
    subject: "Potvrď svoj e-mail",
    hello: "Ahoj,",
    intro: "na stránke Nadbytočná si nechala e-mail, aby si vedela, čo sa chystá.",
    ask: "Potvrď, prosím, že ho chceš použiť:",
    ignore: "Ak si to nebola ty, nič nerob. Bez potvrdenia ti nebudeme písať.",
    unsub: "Odhlásiť sa",
    controller: "Prevádzkovateľ",
    htmlIntro: "Na stránke Nadbytočná si nechala e-mail, aby si vedela, čo sa chystá. Potvrď, prosím, že ho chceš použiť.",
    button: "Potvrdiť e-mail",
  },
};

export function confirmationEmail({ id, token, controllerLine, lang = "cs" }) {
  const t = T[lang] || T.cs;
  const P = PATHS[T[lang] ? lang : "cs"];
  const base = siteUrl();
  const confirmUrl = `${base}${P.confirm}?t=${encodeURIComponent(token)}`;
  const unsubUrl = `${base}${P.unsub}?t=${encodeURIComponent(signUnsub(id))}`;
  const unsubPost = `${base}/api/unsubscribe/?t=${encodeURIComponent(signUnsub(id))}`;
  const text = [
    t.hello,
    "",
    t.intro,
    t.ask,
    confirmUrl,
    "",
    t.ignore,
    "",
    `${t.unsub}: ${unsubUrl}`,
    controllerLine ? `${t.controller}: ${controllerLine}` : "",
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
  const html = `<!doctype html><html lang="${T[lang] ? lang : "cs"}"><body style="margin:0;background:#F4CCD8;font-family:Arial,Helvetica,sans-serif;color:#3A0B22">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4CCD8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFF8FA;border-radius:8px"><tr><td style="padding:32px 28px">
<p style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:#3A0B22"><strong>${esc(t.subject)}</strong></p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.55">${esc(t.htmlIntro)}</p>
<p style="margin:0 0 24px"><a href="${esc(confirmUrl)}" style="display:inline-block;background:#B5094D;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 26px;border-radius:6px">${esc(t.button)}</a></p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#5E2A41">${esc(t.ignore)}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#5E2A41"><a href="${esc(unsubUrl)}" style="color:#5E2A41">${esc(t.unsub)}</a>${controllerLine ? `<br>${esc(t.controller)}: ${esc(controllerLine)}` : ""}</p>
</td></tr></table></td></tr></table></body></html>`;
  return {
    subject: t.subject,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubPost}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
