// Minimum JS. Žádné cookies, žádné třetí strany.
(function () {
  "use strict";
  var page = document.body.getAttribute("data-page");

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, data: j }; });
    });
  }

  if (page === "home") {
    var form = document.getElementById("signup");
    var msg = document.getElementById("msg");
    var email = document.getElementById("email");
    var consent = document.getElementById("consent");
    var btn = document.getElementById("send");
    var ts = document.getElementById("ts");
    ts.value = String(Date.now());

    function say(t, el) { msg.textContent = t; if (el) el.focus(); }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      say("");
      var v = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { say("Zkontroluj prosím e-mailovou adresu, vypadá neúplně.", email); return; }
      if (!consent.checked) { say("Bez souhlasu ti e-mail poslat nemůžeme. Zaškrtni ho prosím.", consent); return; }
      btn.disabled = true;
      post("/api/subscribe", {
        email: v,
        consent: true,
        consent_version: form.getAttribute("data-consent-version"),
        website: form.elements["website"].value,
        ts: Number(ts.value),
      }).then(function (r) {
        if (r.status === 200 && r.data.ok) {
          location.assign("/dekujeme/");
          return;
        }
        btn.disabled = false;
        var m = {
          email: "Zkontroluj prosím e-mailovou adresu, vypadá neúplně.",
          consent: "Bez souhlasu ti e-mail poslat nemůžeme. Zaškrtni ho prosím.",
          version: "Stránka je zastaralá. Obnov ji prosím a zkus to znovu.",
          closed: "Přihlašování se právě otevírá. Zkus to prosím za chvíli.",
          rate: "Zkoušíš to příliš často. Zkus to prosím později.",
          mail: "E-mail se nepodařilo odeslat. Zkus to prosím znovu za chvíli.",
        }[r.data && r.data.error];
        say(m || "Něco se nepovedlo. Zkus to prosím znovu za chvíli.");
      }).catch(function () {
        btn.disabled = false;
        say("Spojení se nezdařilo. Zkontroluj připojení a zkus to znovu.");
      });
    });
  }

  if (page === "confirm" || page === "unsubscribe") {
    var token = new URLSearchParams(location.search).get("t") || "";
    var state = document.getElementById("state");
    var action = document.getElementById("action");
    var url = page === "confirm" ? "/api/confirm" : "/api/unsubscribe";
    var okText = page === "confirm" ? ["Děkujeme, jsi v tom s námi.", "Ozveme se ti, jakmile bude co ukázat."] : ["Odhlášeno.", "Už ti nebudeme psát. Kdyby sis to rozmyslela, můžeš se kdykoli přihlásit znovu."];
    var badText = ["Odkaz nefunguje.", page === "confirm" ? "Možná vypršel. Přihlas se prosím znovu na nadbytecna.cz." : "Napiš nám prosím na adresu uvedenou v zásadách ochrany osobních údajů a odhlásíme tě ručně."];

    function show(h, p) {
      document.getElementById("h").textContent = h;
      document.getElementById("p").textContent = p;
      if (action) action.hidden = true;
      document.getElementById("live").focus();
    }
    function run() {
      if (action) action.disabled = true;
      post(url, { t: token }).then(function (r) {
        if (r.status === 200 && r.data.ok) { if (page === "confirm") location.replace("/potvrzeno/"); else show(okText[0], okText[1]); }
        else show(badText[0], badText[1]);
      }).catch(function () {
        if (action) action.disabled = false;
        document.getElementById("p").textContent = "Spojení se nezdařilo. Zkus to prosím znovu.";
      });
    }
    if (!token) { show(badText[0], badText[1]); }
    else if (page === "unsubscribe") { run(); }
    else if (action) { action.addEventListener("click", run); }
    if (state) state.hidden = false;
  }
})();
