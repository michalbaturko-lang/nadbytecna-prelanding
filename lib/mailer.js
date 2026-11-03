// Odesílání e-mailů přes vyměnitelného providera (MAIL_PROVIDER).
// Rozhraní: send({ to, subject, html, text, headers }) -> Promise<void>
//
//  console  – nic neodesílá, jen vypíše do logu (lokální vývoj, testy)
//  resend   – Resend HTTP API (data v USA, region odesílání lze zvolit; viz Log podkladu)
//  ecomail  – zatím neimplementováno: nástroj není vybrán a endpoint pro transakční e-maily jsem neověřil
//
// Seznam adres a důkazy o souhlasu držíme vždy v Supabase, ne u providera.

const providers = {
  async console(msg) {
    console.log("[mail:console]", JSON.stringify({ to: msg.to, subject: msg.subject, text: msg.text, headers: msg.headers }));
  },

  async resend(msg) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY chybí");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: msg.headers,
      }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },

  async ecomail() {
    throw new Error("Provider 'ecomail' ještě není implementován (čeká na volbu nástroje a ověření API).");
  },
};

export async function sendMail(msg) {
  const name = process.env.MAIL_PROVIDER || "console";
  const send = providers[name];
  if (!send) throw new Error(`Neznámý MAIL_PROVIDER: ${name}`);
  if (name !== "console" && !process.env.MAIL_FROM) throw new Error("MAIL_FROM chybí");
  return send(msg);
}
