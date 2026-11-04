// Minimum JS. Žádné cookies, žádné třetí strany.
(function () {
  "use strict";
  var page = document.body.getAttribute("data-page");
  var lang = document.documentElement.lang === "sk" ? "sk" : "cs";
  var TX = {
    cs: {
      home: "/", thanks: "/dekujeme/", confirmed: "/potvrzeno/",
      email: "Zkontroluj prosím e-mailovou adresu, vypadá neúplně.",
      consent: "Bez souhlasu ti e-mail poslat nemůžeme. Zaškrtni ho prosím.",
      stale: "Stránka je zastaralá. Obnov ji prosím a zkus to znovu.",
      busy: "Právě je tu hodně lidí. Zkus to prosím za pár minut.",
      closed: "Přihlašování se právě otevírá. Zkus to prosím za chvíli.",
      rate: "Zkoušíš to příliš často. Zkus to prosím později.",
      mail: "E-mail se nepodařilo odeslat. Zkus to prosím znovu za chvíli.",
      other: "Něco se nepovedlo. Zkus to prosím znovu za chvíli.",
      net: "Spojení se nezdařilo. Zkontroluj připojení a zkus to znovu.",
      net2: "Spojení se nezdařilo. Zkus to prosím znovu.",
      max: "Můžeš vybrat nejvýš tři. Zrušením jedné uvolníš místo.",
      votetok: "Výběr jde odeslat jen hned po potvrzení e-mailu. Otevři prosím odkaz z e-mailu znovu.",
      demo: "Ukázka: nic se neukládá a počty jsou jen tvoje volba.",
      saved: "Díky. Tvůj výběr je uložený u tvého e-mailu. Odpovědělo ",
      women: ["žena.", "ženy.", "žen."],
      confirmOk: ["Děkujeme, jsi v tom s námi.", "Ozveme se ti, jakmile bude co ukázat."],
      unsubOk: ["Odhlášeno.", "Už ti nebudeme psát. Kdyby sis to rozmyslela, můžeš se kdykoli přihlásit znovu."],
      bad: "Odkaz nefunguje.",
      badConfirm: "Možná vypršel. Přihlas se prosím znovu na nadbytecna.cz.",
      badUnsub: "Napiš nám prosím na adresu uvedenou v zásadách ochrany osobních údajů a odhlásíme tě ručně."
    },
    sk: {
      home: "/sk/", thanks: "/sk/dakujeme/", confirmed: "/sk/potvrdene/",
      email: "Skontroluj, prosím, e-mailovú adresu, vyzerá neúplne.",
      consent: "Bez súhlasu ti e-mail poslať nemôžeme. Zaškrtni ho, prosím.",
      stale: "Stránka je zastaraná. Obnov ju, prosím, a skús to znova.",
      busy: "Práve je tu veľa ľudí. Skús to, prosím, o pár minút.",
      closed: "Prihlasovanie sa práve otvára. Skús to, prosím, o chvíľu.",
      rate: "Skúšaš to príliš často. Skús to, prosím, neskôr.",
      mail: "E-mail sa nepodarilo odoslať. Skús to, prosím, o chvíľu znova.",
      other: "Niečo sa nepodarilo. Skús to, prosím, o chvíľu znova.",
      net: "Spojenie zlyhalo. Skontroluj pripojenie a skús to znova.",
      net2: "Spojenie zlyhalo. Skús to, prosím, znova.",
      max: "Môžeš vybrať najviac tri. Zrušením jednej uvoľníš miesto.",
      votetok: "Výber ide odoslať len hneď po potvrdení e-mailu. Otvor, prosím, odkaz z e-mailu znova.",
      demo: "Ukážka: nič sa neukladá a počty sú len tvoja voľba.",
      saved: "Vďaka. Tvoj výber je uložený pri tvojom e-maile. Odpovedalo ",
      women: ["žena.", "ženy.", "žien."],
      confirmOk: ["Ďakujeme, si v tom s nami.", "Ozveme sa ti, len čo bude čo ukázať."],
      unsubOk: ["Odhlásené.", "Už ti nebudeme písať. Keby si si to rozmyslela, môžeš sa kedykoľvek prihlásiť znova."],
      bad: "Odkaz nefunguje.",
      badConfirm: "Možno vypršal. Prihlás sa, prosím, znova na nadbytecna.cz.",
      badUnsub: "Napíš nám, prosím, na adresu uvedenú v zásadách ochrany osobných údajov a odhlásime ťa ručne."
    }
  }[lang];
  // 1 žena, 2–4 ženy, jinak žen / žien
  function women(n) { return TX.women[n === 1 ? 0 : (n >= 2 && n <= 4 ? 1 : 2)]; }

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
      if (v.length > 254 || !/^[A-Za-z0-9][A-Za-z0-9._%+-]*@[\p{L}\p{N}][\p{L}\p{N}.-]*\.[\p{L}\p{N}-]{2,}$/u.test(v)) { say(TX.email, email); return; }
      if (!consent.checked) { say(TX.consent, consent); return; }
      btn.disabled = true;
      var wait = function () { return new Promise(function (ok) { setTimeout(ok, Math.max(0, 2700 - (Date.now() - fkAt))); }); };
      var send = function (retried) {
        return (fk ? Promise.resolve() : getKey()).then(wait).then(function () {
          return post("/api/subscribe/", {
            email: v,
            consent: true,
            consent_version: form.getAttribute("data-consent-version"),
            lang: lang,
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
          location.assign(TX.thanks);
          return;
        }
        btn.disabled = false;
        var m = {
          email: TX.email, consent: TX.consent, version: TX.stale, stale: TX.stale,
          busy: TX.busy, closed: TX.closed, rate: TX.rate, mail: TX.mail,
        }[r.data && r.data.error];
        say(m || TX.other);
      }).catch(function () {
        btn.disabled = false;
        say(TX.net);
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
          else { vmsg.textContent = TX.max; return; }
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
            ? TX.votetok
            : TX.other;
        }).catch(function () { send.disabled = false; vmsg.textContent = TX.net2; });
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
          ? TX.demo
          : TX.saved + d.voters + " " + women(d.voters);
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
    var okText = page === "confirm" ? TX.confirmOk : TX.unsubOk;
    var badText = [TX.bad, page === "confirm" ? TX.badConfirm : TX.badUnsub];

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
          if (page === "confirm") { try { if (r.data.vote) sessionStorage.setItem("nv", r.data.vote); } catch (e) {} location.replace(TX.confirmed); }
          else show(okText[0], okText[1]);
        }
        else show(badText[0], badText[1]);
      }).catch(function () {
        if (action) action.disabled = false;
        document.getElementById("p").textContent = TX.net2;
      });
    }
    if (!token) { show(badText[0], badText[1]); }
    else if (page === "unsubscribe") { run(); }
    else if (action) { action.addEventListener("click", run); }
    if (state) state.hidden = false;
  }
})();
