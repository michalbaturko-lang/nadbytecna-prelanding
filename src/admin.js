// Přehled pro administrátory. Magic link posílá Supabase Auth, tenhle skript e-mail neposílá sám od sebe.
(function (global) {
  "use strict";
  var STATUSES = ["new", "read", "contacted", "archived"];
  var STATUS_CS = { new: "nové", read: "přečtené", contacted: "kontaktované", archived: "archiv" };
  var sessionKey = "nadbytecna-admin";

  function cfg() {
    var c = global.NADBYTECNA_SUPABASE || {};
    return { url: String(c.url || "").replace(/\/$/, ""), key: String(c.key || "") };
  }
  function $(id) { return document.getElementById(id); }
  function say(text) { $("admin-msg").textContent = text || ""; }
  function b64url(bytes) {
    var s = btoa(String.fromCharCode.apply(null, bytes));
    return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function challenge() {
    var bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    var verifier = b64url(bytes);
    var digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return { verifier: verifier, challenge: b64url(new Uint8Array(digest)) };
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(sessionKey) || "null"); } catch (e) { return null; }
  }
  function saveSession(s) {
    if (!s) sessionStorage.removeItem(sessionKey);
    else sessionStorage.setItem(sessionKey, JSON.stringify(s));
  }
  async function authFetch(path, opt) {
    var c = cfg();
    var headers = Object.assign({ apikey: c.key, "Content-Type": "application/json" }, (opt && opt.headers) || {});
    if (opt && opt.token) headers.Authorization = "Bearer " + opt.token;
    else headers.Authorization = "Bearer " + c.key;
    var res = await fetch(c.url + path, { method: (opt && opt.method) || "GET", headers: headers, body: opt && opt.body });
    return res;
  }
  async function tokenFromCode(code, verifier) {
    var c = cfg();
    var res = await fetch(c.url + "/auth/v1/token?grant_type=pkce", {
      method: "POST",
      headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    if (!res.ok) throw new Error("token");
    return res.json();
  }
  async function refresh(s) {
    var c = cfg();
    var res = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) throw new Error("refresh");
    return res.json();
  }
  function asSession(data) {
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 15000 };
  }
  async function current() {
    var s = loadSession();
    if (!s || !s.access_token) return null;
    if (s.expires_at && s.expires_at < Date.now() && s.refresh_token) {
      s = asSession(await refresh(s));
      saveSession(s);
    }
    return s;
  }

  var state = { tab: "stories", stories: [], help: [], filterType: "", filterStatus: "" };

  function labelStatus(value) { return STATUS_CS[value] || value; }
  function when(value) {
    try { return new Date(value).toLocaleString("cs-CZ"); } catch (e) { return ""; }
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function td(text) {
    var cell = document.createElement("td");
    cell.textContent = text == null ? "" : String(text);
    return cell;
  }
  function filtered(rows, typeKey) {
    return rows.filter(function (row) {
      if (state.filterStatus && row.status !== state.filterStatus) return false;
      if (state.filterType && row[typeKey] !== state.filterType) return false;
      return true;
    });
  }

  function renderList() {
    var body = $("admin-rows");
    clear(body);
    var stories = state.tab === "stories";
    var rows = filtered(stories ? state.stories : state.help, stories ? "input_type" : "helper_type");
    $("admin-count").textContent = rows.length + " záznamů";
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      tr.appendChild(td(when(row.created_at)));
      tr.appendChild(td(row.full_name || ""));
      tr.appendChild(td(stories ? (row.anonymous ? "anonymně" : "se jménem") : (row.helper_type === "lived_experience" ? "prošla/prošel" : "pomáhá")));
      tr.appendChild(td(labelStatus(row.status)));
      var action = document.createElement("td");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Detail";
      btn.addEventListener("click", function () { showDetail(row); });
      action.appendChild(btn);
      tr.appendChild(action);
      body.appendChild(tr);
    });
  }

  function showDetail(row) {
    var box = $("admin-detail");
    clear(box);
    box.hidden = false;
    var title = document.createElement("h2");
    title.textContent = row.full_name || "Bez jména";
    box.appendChild(title);
    var meta = document.createElement("p");
    meta.textContent = row.email + " · " + when(row.created_at);
    box.appendChild(meta);
    var text = document.createElement("p");
    text.textContent = row.story_text || row.message || "";
    box.appendChild(text);
    if (row.transcript) {
      var tr = document.createElement("p");
      tr.textContent = "Přepis: " + row.transcript;
      box.appendChild(tr);
    }
    if (row.audio_path) {
      var play = document.createElement("button");
      play.type = "button";
      play.textContent = "Přehrát audio";
      play.addEventListener("click", function () { playAudio(row.audio_path, box); });
      box.appendChild(play);
    }
    var label = document.createElement("label");
    label.className = "lbl";
    label.htmlFor = "admin-status";
    label.textContent = "Stav";
    var select = document.createElement("select");
    select.id = "admin-status";
    STATUSES.forEach(function (value) {
      var opt = document.createElement("option");
      opt.value = value;
      opt.textContent = labelStatus(value);
      if (value === row.status) opt.selected = true;
      select.appendChild(opt);
    });
    var save = document.createElement("button");
    save.type = "button";
    save.textContent = "Uložit stav";
    save.addEventListener("click", function () { saveStatus(row, select.value); });
    box.appendChild(label);
    box.appendChild(select);
    box.appendChild(save);
  }

  async function playAudio(path, box) {
    var s = await current();
    var c = cfg();
    var safe = String(path).split("/").map(encodeURIComponent).join("/");
    var res = await fetch(c.url + "/storage/v1/object/sign/story-audio/" + safe, {
      method: "POST",
      headers: { apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 120 }),
    });
    if (!res.ok) { say("Audio se nepodařilo otevřít."); return; }
    var data = await res.json();
    var src = data.signedURL || data.signedUrl || "";
    if (src && src.charAt(0) === "/") src = c.url + "/storage/v1" + src;
    var audio = document.createElement("audio");
    audio.controls = true;
    audio.src = src;
    box.appendChild(audio);
    audio.play().catch(function () {});
  }

  async function saveStatus(row, status) {
    if (STATUSES.indexOf(status) < 0) return;
    var s = await current();
    var table = row.input_type ? "stories" : "help_offers";
    var res = await authFetch("/rest/v1/" + table + "?id=eq." + row.id, {
      method: "PATCH",
      token: s.access_token,
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: status }),
    });
    if (!res.ok) { say("Stav se nepodařilo uložit."); return; }
    row.status = status;
    say("Stav je uložený.");
    renderList();
  }

  function csvCell(value) {
    var text = value == null ? "" : Array.isArray(value) ? value.join(" ") : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var stories = state.tab === "stories";
    var rows = filtered(stories ? state.stories : state.help, stories ? "input_type" : "helper_type");
    var cols = stories
      ? ["created_at", "full_name", "email", "anonymous", "wants_to_help", "input_type", "story_text", "audio_path", "transcript", "status"]
      : ["created_at", "full_name", "email", "phone", "helper_type", "help_kinds", "message", "links", "status"];
    var lines = [cols.join(",")];
    rows.forEach(function (row) { lines.push(cols.map(function (key) { return csvCell(row[key]); }).join(",")); });
    var blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = stories ? "pribehy.csv" : "pomoc.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function load() {
    var s = await current();
    var who = await authFetch("/auth/v1/user", { token: s.access_token });
    if (!who.ok) { saveSession(null); showLogin(); say("Přihlášení vypršelo. Pošli si odkaz znovu."); return; }
    var user = await who.json();
    var admin = await authFetch("/rest/v1/admins?select=user_id&user_id=eq." + user.id, { token: s.access_token });
    var admins = admin.ok ? await admin.json() : [];
    if (!admins.length) {
      $("admin-app").hidden = true;
      $("admin-login").hidden = false;
      say("Tenhle účet není v seznamu administrátorů. Postup je v docs/pridat-admina.sql.");
      return;
    }
    var storyRes = await authFetch("/rest/v1/stories?select=id,created_at,full_name,email,anonymous,wants_to_help,input_type,story_text,audio_path,transcript,status&order=created_at.desc&limit=500", { token: s.access_token });
    var helpRes = await authFetch("/rest/v1/help_offers?select=id,created_at,full_name,email,phone,helper_type,help_kinds,message,links,status&order=created_at.desc&limit=500", { token: s.access_token });
    state.stories = storyRes.ok ? await storyRes.json() : [];
    state.help = helpRes.ok ? await helpRes.json() : [];
    $("admin-login").hidden = true;
    $("admin-app").hidden = false;
    say("");
    renderList();
  }

  function showLogin() {
    $("admin-login").hidden = false;
    $("admin-app").hidden = true;
  }

  async function sendLink() {
    var email = $("admin-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Doplň e-mail."); return; }
    var c = cfg();
    if (!c.url || !c.key) { say("Chybí nastavení připojení."); return; }
    var pkce = await challenge();
    sessionStorage.setItem("nadbytecna-admin-verifier", pkce.verifier);
    var redirect = location.origin + "/admin/";
    var res = await fetch(c.url + "/auth/v1/otp?redirect_to=" + encodeURIComponent(redirect), {
      method: "POST",
      headers: { apikey: c.key, Authorization: "Bearer " + c.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, create_user: true, code_challenge: pkce.challenge, code_challenge_method: "s256" }),
    });
    if (!res.ok) { say("Odkaz se nepodařilo poslat. Zkontroluj adresu a nastavení Auth."); return; }
    say("Pokud adresu známe, přijde na ni přihlašovací odkaz.");
  }

  async function boot() {
    var params = new URLSearchParams(location.search);
    var code = params.get("code");
    if (code) {
      var verifier = sessionStorage.getItem("nadbytecna-admin-verifier");
      history.replaceState({}, "", "/admin/");
      if (verifier) {
        try { saveSession(asSession(await tokenFromCode(code, verifier))); }
        catch (e) { say("Odkaz nešel dokončit. Pošli si nový."); }
      }
    }
    var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (hash.get("access_token")) {
      saveSession(asSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"), expires_in: hash.get("expires_in") }));
      history.replaceState({}, "", "/admin/");
    }
    if (await current()) load().catch(function () { say("Přehled se nepodařilo načíst."); });
  }

  $("admin-send").addEventListener("click", function () { sendLink().catch(function () { say("Odkaz se nepodařilo poslat."); }); });
  $("admin-out").addEventListener("click", function () { saveSession(null); showLogin(); say("Jsi odhlášená."); });
  $("tab-stories").addEventListener("click", function () { state.tab = "stories"; fillTypes(); renderList(); });
  $("tab-help").addEventListener("click", function () { state.tab = "help"; fillTypes(); renderList(); });
  $("admin-type").addEventListener("change", function () { state.filterType = $("admin-type").value; renderList(); });
  $("admin-filter-status").addEventListener("change", function () { state.filterStatus = $("admin-filter-status").value; renderList(); });
  $("admin-csv").addEventListener("click", exportCsv);

  function fillTypes() {
    var select = $("admin-type");
    clear(select);
    var first = document.createElement("option");
    first.value = "";
    first.textContent = "Všechny typy";
    select.appendChild(first);
    var options = state.tab === "stories"
      ? [["text", "text"], ["recording", "nahrávka"], ["upload", "soubor"]]
      : [["lived_experience", "prošla/prošel"], ["professional", "pomáhá"]];
    options.forEach(function (pair) {
      var opt = document.createElement("option");
      opt.value = pair[0];
      opt.textContent = pair[1];
      select.appendChild(opt);
    });
    state.filterType = "";
  }
  fillTypes();
  boot();
})(window);
