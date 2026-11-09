// Přihlášení k upozornění na spuštění. Insert bez čtení řádku zpět, e-mail se neposílá.
(function (global) {
  "use strict";
  var MIN_MS = 3000;
  var form = document.getElementById("brzy-form");
  if (!form) return;
  var started = Date.now();
  var msg = document.getElementById("brzy-msg");
  var send = document.getElementById("brzy-send");

  function say(text) { msg.textContent = text || ""; }

  function cfg() {
    var c = global.NADBYTECNA_SUPABASE || {};
    return { url: String(c.url || "").replace(/\/$/, ""), key: String(c.key || "") };
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    say("");
    var hp = document.getElementById("brzy-hp");
    if (hp && String(hp.value || "").trim()) { showThanks(); return; }
    if (Date.now() - started < MIN_MS) { say("Počkejte, prosím, chvilku a zkuste to znovu."); return; }
    var email = document.getElementById("brzy-email").value.trim().toLowerCase();
    var consent = document.getElementById("brzy-gdpr").checked;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Napište, prosím, svůj e-mail."); return; }
    if (!consent) { say("Bez souhlasu se zasláním zprávy to uložit nemůžeme."); return; }
    var c = cfg();
    if (!c.url || !c.key) { say("Odeslání se nepovedlo. Napište nám na veryvera@nadbytecna.cz."); return; }
    send.disabled = true;
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : 0;
    fetch(c.url + "/rest/v1/launch_signups", {
      signal: ctl ? ctl.signal : undefined,
      method: "POST",
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ email: email, consent: true }),
    }).then(function (res) {
      clearTimeout(timer);
      if (res.status === 409) { say("Tento e-mail už máme. 11. 11. se vám ozveme."); send.disabled = false; return; }
      if (!res.ok) throw new Error("insert");
      showThanks();
    }).catch(function (err) {
      clearTimeout(timer);
      send.disabled = false;
      say(ctl && ctl.signal.aborted ? "Spojení je pomalé a odeslání nedoběhlo. Zkuste to prosím znovu." : "Odeslání se nepovedlo. Napište nám na veryvera@nadbytecna.cz.");
    });
  });

  function showThanks() {
    form.hidden = true;
    document.getElementById("brzy-thanks").hidden = false;
  }
})(window);
