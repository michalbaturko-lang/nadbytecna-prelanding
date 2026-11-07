// Přehled pro administrátory. Magic link posílá Supabase Auth.
(function (global) {
  "use strict";
  var STATUSES = ["new", "read", "in_progress", "resolved", "published"];
  var STATUS_CS = { new: "nový", read: "přečtený", in_progress: "v řešení", resolved: "vyřešený", published: "zveřejněný", contacted: "v řešení", archived: "archiv" };
  var CATS = ["práce", "rodina a děti", "zdraví", "finance", "šikana/obtěžování", "bydlení", "jiné"];
  var HELPS = ["právník", "terapeut", "práce", "jiné"];
  var OFFERS = ["právník", "terapeut", "práce", "výrobky/služby", "jiné"];
  var sessionKey = "nadbytecna-admin";
  var state = { tab: "stories", stories: [], help: [], filters: { q: "", named: "", publish: "", help: "", voice: "", category: "", urgency: "", status: "" }, open: null };

  function cfg() {
    var c = global.NADBYTECNA_SUPABASE || {};
    return { url: String(c.url || "").replace(/\/$/, ""), key: String(c.key || "") };
  }
  function $(id) { return document.getElementById(id); }
  function say(text) { var el = $("admin-msg"); if (el) el.textContent = text || ""; }
  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
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
  function loadSession() { try { return JSON.parse(sessionStorage.getItem(sessionKey) || "null"); } catch (e) { return null; } }
  function saveSession(s) { if (!s) sessionStorage.removeItem(sessionKey); else sessionStorage.setItem(sessionKey, JSON.stringify(s)); }
  async function authFetch(path, opt) {
    var c = cfg();
    var headers = Object.assign({ apikey: c.key, "Content-Type": "application/json" }, (opt && opt.headers) || {});
    headers.Authorization = "Bearer " + ((opt && opt.token) || c.key);
    return fetch(c.url + path, { method: (opt && opt.method) || "GET", headers: headers, body: opt && opt.body });
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
  function when(value) { try { return new Date(value).toLocaleString("cs-CZ"); } catch (e) { return ""; } }
  function labelStatus(value) { return STATUS_CS[value] || value || ""; }
  function storyText(row) { return row.story_text || row.transcript || ""; }
  function isVoice(row) { return row.input_type === "recording" || row.input_type === "upload"; }

  function filtered() {
    var stories = state.tab === "stories";
    var rows = stories ? state.stories : state.help;
    var f = state.filters;
    var q = f.q.trim().toLowerCase();
    return rows.filter(function (row) {
      if (f.status && row.status !== f.status) return false;
      if (f.category && row.ai_category !== f.category) return false;
      if (f.urgency && row.ai_urgency !== f.urgency) return false;
      if (stories) {
        if (f.named === "named" && row.anonymous) return false;
        if (f.named === "anon" && !row.anonymous) return false;
        if (f.publish === "yes" && row.consent_publish !== true) return false;
        if (f.publish === "no" && row.consent_publish === true) return false;
        if (f.help === "yes" && !row.wants_to_help) return false;
        if (f.voice === "voice" && !isVoice(row)) return false;
        if (f.voice === "text" && isVoice(row)) return false;
      }
      if (!q) return true;
      var blob = [row.full_name, row.email, row.phone, storyText(row), row.message, row.transcript, row.ai_summary, row.admin_note, row.ai_category].join(" ").toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function chip(text, cls) { return el("span", "tag" + (cls ? " " + cls : ""), text); }

  function aiBlock(row, stories) {
    var box = el("div", "ai-block");
    box.appendChild(el("p", "kicker", "Návrh třídění"));
    box.appendChild(el("p", "ai-summary", row.ai_summary || "Shrnutí zatím není. Můžete ho spustit ručně."));
    var row1 = el("div", "ai-row");
    row1.appendChild(el("span", "tag", row.ai_category || "bez kategorie"));
    row1.appendChild(el("span", "tag", row.ai_help_type || "bez typu pomoci"));
    if (row.ai_urgency === "acute") row1.appendChild(chip("akutní", "tag-acute"));
    else if (row.ai_urgency === "watch") row1.appendChild(chip("k hlídání", "tag-watch"));
    box.appendChild(row1);
    var cats = stories ? CATS : OFFERS;
    var picks = el("div", "ai-picks");
    cats.forEach(function (cat) {
      var b = el("button", "mini" + (row.ai_category === cat ? " is-on" : ""), cat);
      b.type = "button";
      b.addEventListener("click", function () { confirmCategory(row, cat); });
      picks.appendChild(b);
    });
    box.appendChild(picks);
    var run = el("button", "mini", "Spustit AI");
    run.type = "button";
    run.addEventListener("click", function () { runAi(row); });
    box.appendChild(run);
    if (!stories && row.ai_matches) box.appendChild(el("p", "hint", "Shoda: " + row.ai_matches));
    if (!stories) box.appendChild(matches(row));
    return box;
  }

  function matches(offer) {
    var box = el("div", "matches");
    var hits = state.stories.filter(function (s) {
      if (offer.ai_help_type && s.ai_help_type === offer.ai_help_type) return true;
      if (offer.ai_category && s.ai_category === offer.ai_category) return true;
      return false;
    }).slice(0, 3);
    if (!hits.length) return box;
    box.appendChild(el("p", "kicker", "Podobné příběhy"));
    hits.forEach(function (s) {
      box.appendChild(el("p", "hint", (s.ai_summary || storyText(s) || s.full_name || "Příběh").slice(0, 160)));
    });
    return box;
  }

  function card(row) {
    var stories = state.tab === "stories";
    var art = el("article", "story-card" + (row.ai_urgency === "acute" ? " is-acute" : ""));
    art.appendChild(aiBlock(row, stories));
    var head = el("div", "card-head");
    head.appendChild(el("h2", "", row.anonymous ? "Anonymně" : (row.full_name || "Bez jména")));
    head.appendChild(chip(labelStatus(row.status)));
    art.appendChild(head);
    var meta = [];
    if (stories) meta.push(row.anonymous ? "anonymně" : "se jménem");
    if (stories && row.consent_publish) meta.push("chce zveřejnit");
    if (stories && row.wants_to_help) meta.push("chce i pomáhat");
    if (stories) meta.push(isVoice(row) ? "hlas" : "text");
    meta.push(when(row.created_at));
    art.appendChild(el("p", "hint", meta.join(" · ")));
    var body = storyText(row) || row.message || "";
    art.appendChild(el("p", "card-text", body));
    if (row.transcript && row.transcript !== row.story_text) art.appendChild(el("p", "hint", "Přepis: " + row.transcript));
    art.appendChild(el("p", "hint", [row.email, row.phone].filter(Boolean).join(" · ")));
    if (row.audio_path) {
      var play = el("button", "mini", "Přehrát audio");
      play.type = "button";
      play.addEventListener("click", function () { playAudio(row.audio_path, art); });
      art.appendChild(play);
    }
    var note = document.createElement("textarea");
    note.className = "admin-note";
    note.rows = 2;
    note.placeholder = "Interní poznámka";
    note.value = row.admin_note || "";
    var saveNote = el("button", "mini", "Uložit poznámku");
    saveNote.type = "button";
    saveNote.addEventListener("click", function () { saveFields(row, { admin_note: note.value }); });
    art.appendChild(note);
    art.appendChild(saveNote);
    var status = document.createElement("select");
    status.className = "admin-status";
    STATUSES.forEach(function (value) {
      var opt = document.createElement("option");
      opt.value = value;
      opt.textContent = labelStatus(value);
      if (value === row.status) opt.selected = true;
      status.appendChild(opt);
    });
    var saveStatusBtn = el("button", "mini", "Uložit stav");
    saveStatusBtn.type = "button";
    saveStatusBtn.addEventListener("click", function () { saveFields(row, { status: status.value }); });
    art.appendChild(status);
    art.appendChild(saveStatusBtn);
    return art;
  }

  function renderList() {
    var box = $("admin-cards");
    if (!box) return;
    clear(box);
    var rows = filtered();
    $("admin-count").textContent = rows.length + (rows.length === 1 ? " záznam" : " záznamů");
    if (!rows.length) box.appendChild(el("p", "hint", "Žádný záznam neodpovídá filtrům."));
    rows.forEach(function (row) { box.appendChild(card(row)); });
    var detail = $("admin-detail");
    if (detail) { detail.hidden = true; clear(detail); }
  }

  async function saveFields(row, patch) {
    var s = await current();
    if (!s) return;
    var table = state.tab === "stories" ? "stories" : "help_offers";
    var res = await authFetch("/rest/v1/" + table + "?id=eq." + row.id, {
      method: "PATCH",
      token: s.access_token,
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) { say("Uložení se nepovedlo."); return; }
    Object.keys(patch).forEach(function (key) { row[key] = patch[key]; });
    say("Uloženo.");
    renderList();
  }

  function confirmCategory(row, cat) {
    saveFields(row, { ai_category: cat, ai_category_confirmed: true });
  }

  async function runAi(row) {
    var s = await current();
    if (!s) return;
    say("Spouštím třídění.");
    var res = await fetch("/api/triage/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token },
      body: JSON.stringify({ table: state.tab === "stories" ? "stories" : "help_offers", id: row.id, manual: true }),
    });
    var data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok || data.ok === false) { say(data.error === "openai-auth" ? "OpenAI odmítlo klíč." : "Třídění se nepovedlo. Záznam zůstává."); return; }
    if (data.skipped) { say("Třídění je vypnuté, nebo chybí klíč."); return; }
    row.ai_summary = data.summary;
    row.ai_category = data.category;
    row.ai_urgency = data.urgency;
    row.ai_help_type = data.help_type;
    row.ai_model = data.model;
    say("Třídění je hotové.");
    renderList();
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
  }

  function csvCell(value) {
    var text = value == null ? "" : Array.isArray(value) ? value.join(" ") : String(value);
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportCsv() {
    var stories = state.tab === "stories";
    var rows = filtered();
    var cols = stories
      ? ["created_at", "full_name", "email", "anonymous", "wants_to_help", "consent_publish", "input_type", "story_text", "transcript", "ai_summary", "ai_category", "ai_urgency", "ai_help_type", "status", "admin_note"]
      : ["created_at", "full_name", "email", "phone", "helper_type", "help_kinds", "message", "ai_summary", "ai_category", "ai_help_type", "ai_matches", "status", "admin_note"];
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

  function fillCategories() {
    var select = $("admin-category");
    if (!select) return;
    clear(select);
    var first = document.createElement("option");
    first.value = "";
    first.textContent = "Všechny kategorie";
    select.appendChild(first);
    (state.tab === "stories" ? CATS : OFFERS).forEach(function (cat) {
      var opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      select.appendChild(opt);
    });
  }

  function readFilters() {
    function val(id) { var n = $(id); return n ? n.value : ""; }
    state.filters.q = val("admin-q");
    state.filters.named = val("admin-named");
    state.filters.publish = val("admin-publish");
    state.filters.help = val("admin-helpflag");
    state.filters.voice = val("admin-voice");
    state.filters.category = val("admin-category");
    state.filters.urgency = val("admin-urgency");
    state.filters.status = val("admin-filter-status");
    renderList();
  }

  async function load() {
    var s = await current();
    var who = await authFetch("/auth/v1/user", { token: s.access_token });
    if (!who.ok) { saveSession(null); showLogin(); say("Přihlášení vypršelo."); return; }
    var user = await who.json();
    var admin = await authFetch("/rest/v1/admins?select=user_id&user_id=eq." + user.id, { token: s.access_token });
    var admins = admin.ok ? await admin.json() : [];
    var mail = String(user.email || "").toLowerCase();
    var listed = await authFetch("/rest/v1/admin_emails?select=email&email=eq." + encodeURIComponent(mail), { token: s.access_token });
    var emails = listed.ok ? await listed.json() : [];
    if (!admins.length && !emails.length) {
      $("admin-app").hidden = true;
      $("admin-login").hidden = false;
      say("K tomuto přehledu nemáte přístup.");
      return;
    }
    var storyCols = "id,created_at,full_name,email,anonymous,wants_to_help,consent_publish,input_type,story_text,audio_path,transcript,status,ai_summary,ai_category,ai_category_confirmed,ai_urgency,ai_help_type,ai_model,ai_at,admin_note";
    var helpCols = "id,created_at,full_name,email,phone,helper_type,help_kinds,message,links,status,consent_publish,ai_summary,ai_category,ai_category_confirmed,ai_urgency,ai_help_type,ai_model,ai_at,ai_matches,admin_note";
    var storyRes = await authFetch("/rest/v1/stories?select=" + storyCols + "&order=created_at.desc&limit=500", { token: s.access_token });
    var helpRes = await authFetch("/rest/v1/help_offers?select=" + helpCols + "&order=created_at.desc&limit=500", { token: s.access_token });
    state.stories = storyRes.ok ? await storyRes.json() : [];
    state.help = helpRes.ok ? await helpRes.json() : [];
    $("admin-login").hidden = true;
    $("admin-app").hidden = false;
    say("");
    fillCategories();
    renderList();
  }

  function showLogin() {
    $("admin-login").hidden = false;
    $("admin-app").hidden = true;
  }
  async function sendLink() {
    var email = $("admin-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("Doplňte e-mail."); return; }
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
    if (!res.ok) { say("Odkaz se nepodařilo poslat."); return; }
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
        catch (e) { say("Odkaz nešel dokončit."); }
      }
    }
    var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (hash.get("access_token")) {
      saveSession(asSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token"), expires_in: hash.get("expires_in") }));
      history.replaceState({}, "", "/admin/");
    }
    if (await current()) load().catch(function () { say("Přehled se nepodařilo načíst."); });
  }

  function bindFilters() {
    ["admin-q", "admin-named", "admin-publish", "admin-helpflag", "admin-voice", "admin-category", "admin-urgency", "admin-filter-status"].forEach(function (id) {
      var node = $(id);
      if (!node) return;
      node.addEventListener("input", readFilters);
      node.addEventListener("change", readFilters);
    });
    var open = $("admin-filters-open");
    var close = $("admin-filters-close");
    var sheet = $("admin-filters");
    if (open && sheet) open.addEventListener("click", function () { sheet.classList.add("is-open"); });
    if (close && sheet) close.addEventListener("click", function () { sheet.classList.remove("is-open"); });
  }

  $("admin-send").addEventListener("click", function () { sendLink().catch(function () { say("Odkaz se nepodařilo poslat."); }); });
  $("admin-out").addEventListener("click", function () { saveSession(null); showLogin(); say("Jste odhlášeni."); });
  $("tab-stories").addEventListener("click", function () { state.tab = "stories"; $("tab-stories").setAttribute("aria-selected", "true"); $("tab-help").setAttribute("aria-selected", "false"); fillCategories(); renderList(); });
  $("tab-help").addEventListener("click", function () { state.tab = "help"; $("tab-help").setAttribute("aria-selected", "true"); $("tab-stories").setAttribute("aria-selected", "false"); fillCategories(); renderList(); });
  $("admin-csv").addEventListener("click", exportCsv);
  bindFilters();
  boot();
})(window);
