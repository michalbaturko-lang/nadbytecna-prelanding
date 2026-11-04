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
    // Podepsaný token od serveru (čas vydání si nediktuje prohlížeč). Min. 2,5 s od vydání, jinak by to byl robot.
    var fk = "", fkAt = 0;
    function getKey() {
      return fetch("/api/form/", { credentials: "omit", cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) { fk = String(j.k || ""); fkAt = Date.now(); })
        .catch(function () { fk = ""; });
    }
    getKey();

    function say(t, el) { msg.textContent = t; if (el) el.focus(); }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      say("");
      var v = email.value.trim();
      if (v.length > 254 || !/^[A-Za-z0-9][A-Za-z0-9._%+-]*@[\p{L}\p{N}][\p{L}\p{N}.-]*\.[\p{L}\p{N}-]{2,}$/u.test(v)) { say("Zkontroluj prosím e-mailovou adresu, vypadá neúplně.", email); return; }
      if (!consent.checked) { say("Bez souhlasu ti e-mail poslat nemůžeme. Zaškrtni ho prosím.", consent); return; }
      btn.disabled = true;
      var wait = function () { return new Promise(function (ok) { setTimeout(ok, Math.max(0, 2700 - (Date.now() - fkAt))); }); };
      var send = function (retried) {
        return (fk ? Promise.resolve() : getKey()).then(wait).then(function () {
          return post("/api/subscribe/", {
            email: v,
            consent: true,
            consent_version: form.getAttribute("data-consent-version"),
            website: form.elements["website"].value,
            k: fk,
          });
        }).then(function (r) {
          if (r.status === 400 && r.data && r.data.error === "stale" && !retried) { fk = ""; return send(true); }
          return r;
        });
      };
      send(false).then(function (r) {
        if (r.status === 200 && r.data.ok) {
          location.assign("/dekujeme/");
          return;
        }
        btn.disabled = false;
        var m = {
          email: "Zkontroluj prosím e-mailovou adresu, vypadá neúplně.",
          consent: "Bez souhlasu ti e-mail poslat nemůžeme. Zaškrtni ho prosím.",
          version: "Stránka je zastaralá. Obnov ji prosím a zkus to znovu.",
          stale: "Stránka je zastaralá. Obnov ji prosím a zkus to znovu.",
          busy: "Právě je tu hodně lidí. Zkus to prosím za pár minut.",
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


  // Výběr výroků po potvrzení e-mailu (nepovinné, max 3). Token z potvrzení je jen v sessionStorage.
  if (document.body.hasAttribute("data-vote")) {
    var box = document.getElementById("vote");
    var tok = ""; try { tok = sessionStorage.getItem("nv") || ""; } catch (e) {}
    var demo = /\.vercel\.app$/.test(location.hostname);
    if (box && (tok || demo)) {
      box.hidden = false;
      var picks = Array.prototype.slice.call(document.querySelectorAll("#picks .pick"));
      var send = document.getElementById("vote-send"), vmsg = document.getElementById("vote-msg");
      var chosen = [];
      picks.forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-id"), at = chosen.indexOf(id);
          if (at >= 0) chosen.splice(at, 1);
          else if (chosen.length < 3) chosen.push(id);
          else { vmsg.textContent = "Můžeš vybrat nejvýš tři. Zrušením jedné uvolníš místo."; return; }
          vmsg.textContent = "";
          picks.forEach(function (x) { x.setAttribute("aria-pressed", chosen.indexOf(x.getAttribute("data-id")) >= 0 ? "true" : "false"); });
          send.disabled = chosen.length === 0;
        });
      });
      send.addEventListener("click", function () {
        send.disabled = true; vmsg.textContent = "";
        post("/api/vote/", { v: tok, claims: chosen }).then(function (r) {
          if (r.status === 200 && r.data.ok) { showResults(r.data); return; }
          send.disabled = false;
          vmsg.textContent = r.data && r.data.error === "token"
            ? "Výběr jde odeslat jen hned po potvrzení e-mailu. Otevři prosím odkaz z e-mailu znovu."
            : "Něco se nepovedlo. Zkus to prosím znovu za chvíli.";
        }).catch(function () { send.disabled = false; vmsg.textContent = "Spojení se nezdařilo. Zkus to prosím znovu."; });
      });
      function showResults(d) {
        var list = document.getElementById("bars"); list.textContent = "";
        var max = 1; picks.forEach(function (b) { max = Math.max(max, d.counts[b.getAttribute("data-id")] || 0); });
        picks.forEach(function (b) {
          var id = b.getAttribute("data-id"), n = d.counts[id] || 0;
          var li = document.createElement("li");
          if (chosen.indexOf(id) >= 0) li.className = "mine";
          var t = document.createElement("span"); t.className = "bt"; t.textContent = b.textContent;
          var bar = document.createElement("span"); bar.className = "bar"; var fill = document.createElement("i"); fill.style.width = Math.round(n / max * 100) + "%"; bar.appendChild(fill);
          var c = document.createElement("span"); c.className = "bn"; c.textContent = String(n);
          li.appendChild(t); li.appendChild(bar); li.appendChild(c); list.appendChild(li);
        });
        document.getElementById("vote-note").textContent = d.demo
          ? "Ukázka: nic se neukládá a počty jsou jen tvoje volba."
          : "Díky. Tvůj výběr je uložený u tvého e-mailu. Odpovědělo " + d.voters + (d.voters === 1 ? " žena." : " žen.");
        document.getElementById("picks").hidden = true; send.hidden = true; vmsg.textContent = "";
        document.querySelector(".vote-sub").hidden = true;
        document.getElementById("results").hidden = false;
        document.getElementById("results").setAttribute("tabindex", "-1"); document.getElementById("results").focus();
      }
    }
  }

  if (page === "confirm" || page === "unsubscribe") {
    var token = new URLSearchParams(location.search).get("t") || "";
    var state = document.getElementById("state");
    var action = document.getElementById("action");
    var url = page === "confirm" ? "/api/confirm/" : "/api/unsubscribe/";
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
        if (r.status === 200 && r.data.ok) {
          if (page === "confirm") { try { if (r.data.vote) sessionStorage.setItem("nv", r.data.vote); } catch (e) {} location.replace("/potvrzeno/"); }
          else show(okText[0], okText[1]);
        }
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
