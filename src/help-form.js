(function () {
  "use strict";
  var root = document.getElementById("help-form");
  if (!root) return;
  var preset = new URLSearchParams(location.search).get("typ");
  if (preset) {
    var radios = root.querySelectorAll('input[name="druh"]');
    for (var i = 0; i < radios.length; i++) if (radios[i].value === preset) radios[i].checked = true;
  }
  var started = Date.now();
  var pendingId = null;
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
    var type = document.querySelector('#help-form input[name="druh"]:checked');
    var consent = document.getElementById("pomoc-gdpr").checked;
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Doplň jméno a e-mail."); return; }
    if (!type) { say("Vyber, jak chceš pomoci."); return; }
    if (!document.getElementById("pomoc-age").checked) { say("Potvrď, že ti je 18 let."); return; }
    if (!consent) { say("Bez souhlasu se zpracováním nabídky to poslat nemůžeme."); return; }
    var kinds = [type.value];
    var links = {
      instagram: val("pomoc-ig"),
      facebook: val("pomoc-fb"),
      eshop: val("pomoc-eshop"),
      web: val("pomoc-web"),
    };
    sendBtn.disabled = true;
    if (!pendingId) pendingId = api.uuid();
    var id = pendingId;
    api.insertRow("help_offers", {
      id: id,
      full_name: name,
      email: email,
      phone: val("pomoc-telefon") || null,
      helper_type: type.value === "potencial" ? "lived_experience" : "professional",
      help_kinds: kinds,
      message: val("pomoc-text") || null,
      links: JSON.stringify(links),
      consent: true,
      age_confirmed: true,
      consent_publish: null,
    }).then(function () {
      api.done("help_offers", id);
      root.querySelector("fieldset").hidden = true;
      sendBtn.hidden = true;
      document.getElementById("pomoc-thanks-text").textContent = type.value === "potencial"
        ? "Děkujeme, že chceš pomoct, protože sis tím prošla nebo prošel. Ozveme se na e-mail, který jsi uvedla."
        : "Děkujeme za nabídku pomoci. Ozveme se na e-mail, který jsi uvedla.";
      document.getElementById("pomoc-thanks").hidden = false;
    }).catch(function (err) {
      sendBtn.disabled = false;
      say(err && err.message === "timeout" ? api.timeoutMessage : "Odeslání se nepovedlo. Napiš na veryvera@nadbytecna.cz.");
    });
  });
})();
