(function () {
  "use strict";
  var root = document.getElementById("help-form");
  if (!root) return;
  var started = Date.now();
  var sendBtn = document.getElementById("pomoc-send");
  function say(text) { document.getElementById("pomoc-msg").textContent = text; }
  function val(id) { return document.getElementById(id).value.trim(); }
  sendBtn.addEventListener("click", function () {
    say("");
    var api = window.NadbytecnaSubmit;
    if (!api) { say("Odeslání se nepovedlo. Napiš na veryvera@nadbytecna.cz."); return; }
    var spam = api.gate(document.getElementById("pomoc-hp"), started);
    if (spam === "fast") { say("Počkej chvilku a zkus to znovu."); return; }
    if (spam === "bot") {
      root.querySelector("fieldset").hidden = true;
      sendBtn.hidden = true;
      document.getElementById("pomoc-thanks-text").textContent = "Děkujeme. Ozveme se na e-mail, který jsi uvedla.";
      document.getElementById("pomoc-thanks").hidden = false;
      return;
    }
    var name = val("pomoc-jmeno");
    var email = val("pomoc-email");
    var type = document.querySelector('#help-form input[name="jak"]:checked');
    var consent = document.getElementById("pomoc-gdpr").checked;
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Doplň jméno a e-mail."); return; }
    if (!type) { say("Vyber, jestli sis tím prošla, nebo pomáháš takovým lidem."); return; }
    if (!consent) { say("Bez souhlasu se zpracováním to poslat nemůžeme."); return; }
    var kinds = Array.prototype.map.call(document.querySelectorAll('#help-form input[name="kind"]:checked'), function (el) { return el.value; });
    var links = {
      instagram: val("pomoc-ig"),
      facebook: val("pomoc-fb"),
      eshop: val("pomoc-eshop"),
      web: val("pomoc-web"),
    };
    sendBtn.disabled = true;
    var id = api.uuid();
    api.insertRow("help_offers", {
      id: id,
      full_name: name,
      email: email,
      phone: val("pomoc-telefon") || null,
      helper_type: type.value,
      help_kinds: type.value === "professional" ? kinds : [],
      message: val("pomoc-text") || null,
      links: JSON.stringify(links),
      consent: true,
    }).then(function () {
      api.done("help_offers", id);
      root.querySelector("fieldset").hidden = true;
      sendBtn.hidden = true;
      document.getElementById("pomoc-thanks-text").textContent = type.value === "lived_experience"
        ? "Děkujeme, že chceš pomoct, protože sis tím prošla nebo prošel. Ozveme se na e-mail, který jsi uvedla."
        : "Děkujeme za nabídku pomoci. Ozveme se na e-mail, který jsi uvedla.";
      document.getElementById("pomoc-thanks").hidden = false;
    }).catch(function () {
      sendBtn.disabled = false;
      say("Odeslání se nepovedlo. Napiš na veryvera@nadbytecna.cz.");
    });
  });
})();
