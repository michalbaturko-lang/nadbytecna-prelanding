// Příběh se odesílá přes submit.js. Blob žije jen v paměti stránky, dokud se nenahraje.
// storyDraft() drží tvar nahrávky: full_name, email, share_mode, also_help, input, body_text,
// audio_source, audio_mime, audio_filename, audio_bytes, audio (Blob).
// transcript zůstane prázdný, dokud nepřibude přepis. Cesta v bucketu je story-audio.
(function () {
  "use strict";
  var root = document.getElementById("story-form");
  if (!root) return;
  var AUDIO_MAX = 50 * 1024 * 1024;
  var micBlob = null, micUrl = "", micMime = "", fileBlob = null, fileUrl = "", fileMime = "", fileName = "";
  var stream = null, rec = null;

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var list = ["audio/mp4", "audio/aac", "audio/mp4;codecs=mp4a.40.2", "audio/webm;codecs=opus", "audio/webm"];
    for (var i = 0; i < list.length; i++) if (MediaRecorder.isTypeSupported(list[i])) return list[i];
    return "";
  }

  function storyDraft() {
    var tab = document.querySelector("#story-modes [role=tab][aria-selected=true]");
    var share = document.querySelector('#story-form input[name="share"]:checked');
    var input = tab ? tab.getAttribute("data-input") : "text";
    var audio = input === "recording" ? micBlob : input === "file" ? fileBlob : null;
    return {
      full_name: document.getElementById("sdilet-jmeno").value.trim(),
      email: document.getElementById("sdilet-email").value.trim(),
      share_mode: share ? share.value : null,
      also_help: document.getElementById("sdilet-help").checked,
      input: input,
      body_text: document.getElementById("sdilet-text").value,
      audio_source: audio ? input : null,
      audio_mime: input === "recording" ? micMime : input === "file" ? fileMime : "",
      audio_filename: input === "file" ? fileName : audio ? "hlasova-zprava" : "",
      audio_bytes: audio ? audio.size : 0,
      audio: audio,
      transcript: null
    };
  }
  root.storyDraft = storyDraft;

  function say(id, text) { document.getElementById(id).textContent = text; }

  function stopTracks() {
    if (!stream) return;
    stream.getTracks().forEach(function (t) { t.stop(); });
    stream = null;
  }

  function playable(el, blob) {
    if (el._url) URL.revokeObjectURL(el._url);
    el._url = URL.createObjectURL(blob);
    el.src = el._url;
    el.hidden = false;
  }

  function clearMic() {
    stopTracks();
    if (rec && rec.state === "recording") rec.stop();
    rec = null;
    micBlob = null; micMime = "";
    var player = document.getElementById("mic-player");
    if (player._url) URL.revokeObjectURL(player._url);
    player._url = "";
    player.removeAttribute("src");
    player.hidden = true;
    document.getElementById("mic-actions").hidden = true;
    document.getElementById("mic-stop").hidden = true;
    document.getElementById("mic-start").hidden = false;
  }

  function beginRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      say("mic-status", "Nahrávání v tomto prohlížeči nejde. Použij nahrání souboru.");
      return;
    }
    say("mic-status", "Nahrávám…");
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s;
      var mime = pickMime();
      var chunks = [];
      try { rec = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s); }
      catch (e) { rec = new MediaRecorder(s); }
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      rec.onstop = function () {
        stopTracks();
        var type = (rec && rec.mimeType) || mime || "audio/mp4";
        micMime = type;
        micBlob = new Blob(chunks, { type: type });
        playable(document.getElementById("mic-player"), micBlob);
        document.getElementById("mic-actions").hidden = false;
        document.getElementById("mic-stop").hidden = true;
        document.getElementById("mic-start").hidden = true;
        say("mic-status", "Nahrávka je připravená. Hlasové zprávy přepisujeme na text.");
      };
      try { rec.start(250); } catch (e) { rec.start(); }
      document.getElementById("mic-start").hidden = true;
      document.getElementById("mic-stop").hidden = false;
    }).catch(function () {
      say("mic-status", "Mikrofon se nepodařilo zapnout. Můžeš nahrát audio soubor.");
    });
  }

  document.getElementById("mic-start").addEventListener("click", beginRecording);
  document.getElementById("mic-stop").addEventListener("click", function () {
    if (rec && rec.state === "recording") rec.stop();
  });
  document.getElementById("mic-delete").addEventListener("click", function () {
    clearMic();
    say("mic-status", "");
  });
  document.getElementById("mic-again").addEventListener("click", function () {
    clearMic();
    beginRecording();
  });

  document.getElementById("audio-file").addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    var player = document.getElementById("file-player");
    if (!file) return;
    if (file.size > AUDIO_MAX) {
      e.target.value = "";
      if (player._url) URL.revokeObjectURL(player._url);
      player._url = "";
      player.removeAttribute("src");
      player.hidden = true;
      fileBlob = null; fileName = ""; fileMime = "";
      say("file-status", "Soubor je větší než 50 MB. Vyber menší.");
      return;
    }
    fileBlob = file;
    fileName = file.name;
    fileMime = file.type || "audio/mp4";
    playable(player, file);
    var kb = Math.max(1, Math.round(file.size / 1024));
    say("file-status", file.name + " · " + kb + " kB. Hlasové zprávy přepisujeme na text.");
  });

  var tabs = Array.prototype.slice.call(document.querySelectorAll("#story-modes [role=tab]"));
  function select(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    var input = tab.getAttribute("data-input");
    var box = document.getElementById("sdilet-consent-transcript");
    if (box) box.hidden = input === "text";
  }
  var started = Date.now();
  var sendBtn = document.getElementById("sdilet-send");
  function storySay(text) { document.getElementById("sdilet-msg").textContent = text; }
  function showThanks(text) {
    document.getElementById("sdilet-fields").hidden = true;
    document.getElementById("sdilet-thanks-text").textContent = text;
    document.getElementById("sdilet-thanks").hidden = false;
  }
  sendBtn.addEventListener("click", function () {
    storySay("");
    var api = window.NadbytecnaSubmit;
    if (!api) { storySay("Odeslání se nepovedlo. Napiš na veryvera@nadbytecna.cz."); return; }
    var spam = api.gate(document.getElementById("sdilet-hp"), started);
    if (spam === "fast") { storySay("Počkej chvilku a zkus to znovu."); return; }
    var name = document.getElementById("sdilet-jmeno").value.trim();
    var email = document.getElementById("sdilet-email").value.trim();
    var share = document.querySelector('#story-form input[name="share"]:checked');
    var tab = document.querySelector("#story-modes [role=tab][aria-selected=true]");
    var input = tab ? tab.getAttribute("data-input") : "text";
    var text = document.getElementById("sdilet-text").value.trim();
    var help = document.getElementById("sdilet-help").checked;
    var consent = document.getElementById("sdilet-gdpr").checked;
    if (spam === "bot") { showThanks("Děkujeme. Ozveme se na e-mail, který jsi uvedla."); return; }
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { storySay("Doplň jméno a e-mail."); return; }
    if (!share) { storySay("Vyber, jestli chceš sdílet anonymně, nebo se jménem."); return; }
    if (!consent) { storySay("Bez souhlasu se zpracováním příběhu to poslat nemůžeme."); return; }
    var audio = input === "recording" || input === "file";
    if (audio && !document.getElementById("sdilet-prepis").checked) { storySay("U hlasu je potřeba souhlas s přepisem."); return; }
    if (input === "text" && !text) { storySay("Napiš příběh, nebo přepni na hlas."); return; }
    if (input === "recording" && !micBlob) { storySay("Nejdřív nahraj hlasovou zprávu."); return; }
    if (input === "file" && !fileBlob) { storySay("Nejdřív vyber audio soubor."); return; }
    var id = api.uuid();
    var blob = input === "recording" ? micBlob : input === "file" ? fileBlob : null;
    var fname = input === "file" ? fileName : (micMime.indexOf("webm") >= 0 ? "hlas.webm" : "hlas.m4a");
    sendBtn.disabled = true;
    var uploaded = blob ? api.uploadAudio(id, blob, fname) : Promise.resolve(null);
    uploaded.then(function (audioPath) {
      return api.insertRow("stories", {
        id: id,
        full_name: name,
        email: email,
        anonymous: share.value === "anonymous",
        wants_to_help: help,
        input_type: input === "file" ? "upload" : input,
        story_text: input === "text" ? text : (text || null),
        audio_path: audioPath,
        consent: true,
        consent_transcript: audio ? true : null,
        consent_publish: document.getElementById("sdilet-zverejneni").checked,
      });
    }).then(function () {
      api.done("stories", id, blob ? { audio: blob, filename: fname } : null);
      var msg = input === "text"
        ? "Dostali jsme tvůj příběh. Ozveme se na e-mail, který jsi uvedla."
        : "Dostali jsme tvou hlasovou zprávu. Přepíšeme ji na text a ozveme se na e-mail.";
      if (share.value === "anonymous") msg += " Jméno k příběhu nepřidáme.";
      if (help) msg += " Ozveme se i k tomu, že chceš pomáhat.";
      showThanks(msg);
    }).catch(function () {
      sendBtn.disabled = false;
      storySay("Odeslání se nepovedlo. Napiš na veryvera@nadbytecna.cz.");
    });
  });

  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { select(tab); });
    tab.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
      else if (e.key === "ArrowLeft") next = tabs[(i + tabs.length - 1) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next);
      next.focus();
    });
  });
})();
