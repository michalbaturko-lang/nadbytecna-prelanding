// Citlivá data se neukládají mimo paměť stránky. Přihlašovací token je pouze v sessionStorage.
(function (global) {
  "use strict";
  var sessionKey = "nadbytecna-admin";
  function cfg() {
    var c = global.NADBYTECNA_SUPABASE || {};
    return {
      url: String(c.url || "").replace(/\/$/, ""),
      key: String(c.key || ""),
    };
  }
  function $(id) {
    return document.getElementById(id);
  }
  function say(text) {
    var el = $("admin-msg");
    if (el) el.textContent = text || "";
  }
  function clear(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }
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
    var digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    return { verifier: verifier, challenge: b64url(new Uint8Array(digest)) };
  }
  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(sessionKey) || "null");
    } catch (e) {
      return null;
    }
  }
  function saveSession(s) {
    if (!s) sessionStorage.removeItem(sessionKey);
    else sessionStorage.setItem(sessionKey, JSON.stringify(s));
  }
  async function authFetch(path, opt) {
    var c = cfg();
    var headers = Object.assign(
      { apikey: c.key, "Content-Type": "application/json" },
      (opt && opt.headers) || {},
    );
    headers.Authorization = "Bearer " + ((opt && opt.token) || c.key);
    return fetch(c.url + path, {
      method: (opt && opt.method) || "GET",
      headers: headers,
      body: opt && opt.body,
    });
  }
  async function tokenFromCode(code, verifier) {
    var c = cfg();
    var res = await fetch(c.url + "/auth/v1/token?grant_type=pkce", {
      method: "POST",
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
    });
    if (!res.ok) throw new Error("token");
    return res.json();
  }
  async function refresh(s) {
    var c = cfg();
    var res = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: {
        apikey: c.key,
        Authorization: "Bearer " + c.key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) throw new Error("refresh");
    return res.json();
  }
  function asSession(data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 15000,
    };
  }
  async function current() {
    var epoch = S.authEpoch;
    var s = loadSession();
    if (!s || !s.access_token) return null;
    if (s.expires_at && s.expires_at < Date.now() && s.refresh_token) {
      s = asSession(await refresh(s));
      if (epoch !== S.authEpoch || !loadSession()) return null;
      saveSession(s);
    }
    return s;
  }
  var S = {
    rows: [],
    filters: {},
    page: 0,
    total: 0,
    categories: [],
    user: null,
    aiEnabled: false,
    detail: null,
    serial: 0,
    detailSerial: 0,
    authEpoch: 0,
    pending: new Set(),
    busy: false,
    view: "stories",
  };
  var M = {
    rows: [],
    filters: {},
    page: 0,
    total: 0,
    serial: 0,
    detailSerial: 0,
    detail: null,
    status: null,
    pending: new Set(),
    connectSerial: 0,
    connectBusy: false,
    inviteExpiresAt: 0,
    inviteTimer: null,
  };
  var STATUSES = {
    new: "Nový",
    in_progress: "V řešení",
    contacted: "Kontaktováno",
    published: "Zveřejněno",
    archived: "Archiv",
  };
  var URGENCIES = {
    low: "Nízká",
    medium: "Střední",
    high: "Vysoká",
    acute: "Akutní",
  };
  var FIELDS = [
    ["q", "Hledat ve zprávách a poznámkách"],
    [
      "anonymous",
      "Jméno",
      [
        ["false", "Jménem"],
        ["true", "Anonymně"],
      ],
    ],
    [
      "consent_publish",
      "Souhlas se zveřejněním",
      [
        ["true", "Chce zveřejnit"],
        ["false", "Nechce zveřejnit"],
      ],
    ],
    [
      "wants_to_help",
      "Aktivní spolupráce",
      [
        ["true", "Chce pomáhat"],
        ["false", "Bez nabídky spolupráce"],
      ],
    ],
    [
      "input_type",
      "Typ vstupu",
      [
        ["text", "Text"],
        ["recording", "Nahrávka"],
        ["upload", "Nahraný soubor"],
      ],
    ],
    [
      "helper_type",
      "Typ pomocníka",
      [
        ["lived_experience", "Vlastní zkušenost"],
        ["professional", "Profesionál"],
      ],
    ],
    ["category", "Kategorie", []],
    ["urgency", "Naléhavost", Object.entries(URGENCIES)],
    ["status", "Stav", Object.entries(STATUSES)],
    [
      "ai",
      "AI",
      [
        ["yes", "Hotovo"],
        ["no", "Zatím ne"],
        ["error", "Chyba"],
      ],
    ],
    [
      "confirmed",
      "Potvrzení adminem",
      [
        ["true", "Potvrzeno"],
        ["false", "Nepotvrzeno"],
      ],
    ],
    ["expiring", "Retence", [["true", "Bude smazáno do 14 dnů"]]],
  ];
  function node(tag, cls, text) {
    return el(tag, cls, text);
  }
  function button(text, fn, cls) {
    var b = node("button", cls || "", text);
    b.type = "button";
    b.addEventListener("click", function () {
      Promise.resolve().then(fn).catch(error);
    });
    return b;
  }
  function error(e) {
    if (e && (e.name === "AbortError" || e.message === "cancelled")) return;
    say(
      e && e.message === "publish_consent"
        ? "Zveřejnění vyžaduje souhlas a doložené potvrzení 18+."
        : e && e.message === "ai_disabled"
          ? "AI čeká na schválení advokátkou."
          : e && e.message === "auth"
            ? "Přihlášení vypršelo. Přihlaste se znovu."
            : "Akci se nepodařilo dokončit. Zkuste to znovu.",
    );
  }
  function when(v) {
    return v
      ? new Date(v).toLocaleString("cs-CZ", {
          timeZone: "Europe/Prague",
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "Nedoloženo";
  }
  function category(code) {
    var c = S.categories.find(function (x) {
      return x.code === code;
    });
    return c ? c.name : code || "Bez kategorie";
  }
  function tag(text, acute) {
    return node("span", "tag" + (acute ? " acute" : ""), text);
  }
  function tags(row) {
    var box = node("div", "tag-row");
    box.append(
      tag(row.entity === "stories" ? "Příběh" : "Nabídka pomoci"),
      tag(STATUSES[row.status] || row.status),
    );
    if (row.urgency)
      box.append(
        tag(URGENCIES[row.urgency] || row.urgency, row.urgency === "acute"),
      );
    if (row.erasure_requested_at) box.append(tag("Výmaz čeká na dokončení"));
    if (row.anonymous) box.append(tag("Anonymně"));
    if (row.consent_publish) box.append(tag("Chce zveřejnit"));
    if (row.age_confirmed) box.append(tag("18+"));
    else box.append(tag("18+ nedoloženo"));
    if (row.wants_to_help) box.append(tag("Chce pomáhat"));
    if (row.input_type !== "text")
      box.append(
        tag(row.input_type === "upload" ? "Nahraný soubor" : "Nahrávka"),
      );
    return box;
  }
  async function api(body, download, endpoint) {
    var epoch = S.authEpoch;
    var s = await current();
    if (epoch !== S.authEpoch) throw new Error("cancelled");
    if (!s) {
      await logout();
      throw new Error("auth");
    }
    var controller = new AbortController();
    S.pending.add(controller);
    if (endpoint) M.pending.add(controller);
    try {
      var r = await fetch(endpoint || "/api/admin/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + s.access_token,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      if (epoch !== S.authEpoch) throw new Error("cancelled");
      if (!r.ok) {
        var e = await r.json().catch(function () {
          return {};
        });
        if (epoch !== S.authEpoch) throw new Error("cancelled");
        if (r.status === 401 || r.status === 403) {
          await logout();
          say("K přehledu nemáte přístup nebo přihlášení vypršelo.");
        }
        throw new Error(e.error || "request");
      }
      var data = download ? await r.blob() : await r.json();
      if (epoch !== S.authEpoch) throw new Error("cancelled");
      lastActivity = Date.now();
      if (
        !endpoint &&
        !download &&
        ["update", "person_erase"].includes(body.action)
      ) {
        api({ action: "init" })
          .then(function (d) {
            renderCounts(d.counts);
          })
          .catch(error);
      }
      return data;
    } finally {
      S.pending.delete(controller);
      if (endpoint) M.pending.delete(controller);
    }
  }
  function downloadBlob(blob, name) {
    var u = URL.createObjectURL(blob),
      a = node("a");
    a.href = u;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(u);
    }, 1000);
  }
  function showLogin() {
    $("admin-app").hidden = true;
    $("admin-login").hidden = false;
    $("admin-out").hidden = true;
  }
  function stopAudio(root) {
    (root || document).querySelectorAll("audio").forEach(function (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    });
  }
  async function logout() {
    var s = loadSession();
    S.authEpoch++;
    S.serial++;
    S.detailSerial++;
    S.pending.forEach(function (controller) {
      controller.abort();
    });
    S.pending.clear();
    clearMail();
    S.view = "stories";
    $("admin-stories").hidden = false;
    $("admin-mail").hidden = true;
    setViewButtons();
    stopAudio();
    document.querySelectorAll("dialog").forEach(function (dialog) {
      if (dialog.open) dialog.close();
      dialog.remove();
    });
    saveSession(null);
    S.rows = [];
    S.detail = null;
    S.user = null;
    S.categories = [];
    S.filters = {};
    S.page = 0;
    S.total = 0;
    S.aiEnabled = false;
    clear($("filter-fields"));
    clear($("secondary-counts"));
    clear($("offer-counts"));
    $("admin-filters").hidden = true;
    $("admin-filters-open").setAttribute("aria-expanded", "false");
    clear($("admin-cards"));
    clear($("admin-detail"));
    clear($("admin-counts"));
    $("admin-detail").hidden = true;
    $("admin-app").classList.remove("detail-open");
    showLogin();
    if (s) {
      fetch("/api/admin/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + s.access_token,
        },
        body: JSON.stringify({ action: "logout" }),
      }).catch(function () {});
      authFetch("/auth/v1/logout", {
        method: "POST",
        token: s.access_token,
      }).catch(function () {});
    }
  }
  var lastActivity = Date.now();
  ["pointerdown", "keydown", "touchstart"].forEach(function (name) {
    document.addEventListener(
      name,
      function () {
        lastActivity = Date.now();
      },
      { passive: true },
    );
  });
  setInterval(function () {
    if (loadSession() && Date.now() - lastActivity >= 12 * 3600e3) {
      logout();
      say("Po 12 hodinách nečinnosti jste odhlášeni.");
    }
  }, 30000);
  function syncUrl() {
    var p = new URLSearchParams();
    Object.keys(S.filters).forEach(function (k) {
      if (k !== "q" && S.filters[k]) p.set(k, S.filters[k]);
    });
    if (S.page) p.set("page", S.page);
    history.replaceState({}, "", location.pathname + (p.size ? "?" + p : ""));
  }
  function readUrl() {
    var p = new URLSearchParams(location.search);
    var allowed = FIELDS.map(function (f) {
      return f[0];
    }).concat(["entity", "sort", "days"]);
    allowed.forEach(function (k) {
      if (k !== "q" && p.get(k)) S.filters[k] = p.get(k);
    });
    S.page = Math.max(0, Number(p.get("page")) || 0);
  }
  function pick(label, id, choices, value, empty) {
    var wrap = node("div"),
      l = node("label", "", label),
      select = node("select");
    l.htmlFor = id;
    select.id = id;
    var opt = node("option", "", empty || "Vše");
    opt.value = "";
    select.append(opt);
    choices.forEach(function (c) {
      var o = node("option", "", c[1]);
      o.value = c[0];
      select.append(o);
    });
    select.value = value || "";
    wrap.append(l, select);
    return { wrap: wrap, input: select };
  }
  function renderFilters() {
    var box = $("filter-fields");
    clear(box);
    FIELDS.forEach(function (f) {
      var wrap, input;
      if (f[0] === "q") {
        wrap = node("div");
        var l = node("label", "", "Hledat");
        l.htmlFor = "filter-q";
        input = node("input");
        input.id = "filter-q";
        input.type = "search";
        input.maxLength = 200;
        input.value = S.filters.q || "";
        input.placeholder = "Jméno, e-mail, text…";
        wrap.append(l, input);
      } else {
        var choices =
          f[0] === "category"
            ? S.categories.map(function (c) {
                return [c.code, c.name];
              })
            : f[2];
        var p = pick(f[1], "filter-" + f[0], choices, S.filters[f[0]]);
        wrap = p.wrap;
        input = p.input;
      }
      var timer;
      input.addEventListener(f[0] === "q" ? "input" : "change", function () {
        clearTimeout(timer);
        timer = setTimeout(
          function () {
            S.filters[f[0]] = input.value;
            S.page = 0;
            closeDetail();
            loadList().catch(error);
          },
          f[0] === "q" ? 350 : 0,
        );
      });
      box.append(wrap);
    });
    $("admin-sort").value = S.filters.sort || "newest";
    document.querySelectorAll("[data-entity]").forEach(function (b) {
      b.setAttribute(
        "aria-pressed",
        String((S.filters.entity || "") === b.dataset.entity),
      );
    });
  }
  function applyFilter(patch) {
    S.filters = patch;
    S.page = 0;
    closeDetail();
    renderFilters();
    loadList().catch(error);
  }
  function renderCounts(c) {
    var box = $("admin-counts"),
      secondary = $("secondary-counts");
    clear(box);
    clear(secondary);
    [
      ["Nové", "new", { status: "new" }],
      ["V řešení", "in_progress", { status: "in_progress" }],
      ["Akutní", "acute", { urgency: "acute" }],
      ["Čeká na AI", "waiting", { ai: "no" }],
      ["Chce zveřejnit", "publish", { consent_publish: "true" }],
      ["Za 7 dní", "week", { days: "7" }],
      ["Za 30 dní", "month", { days: "30" }],
    ].forEach(function (x) {
      var b = button(
        "",
        function () {
          applyFilter(x[2]);
        },
        "count" + (x[1] === "acute" ? " acute" : ""),
      );
      b.append(node("strong", "", String(c[x[1]])), node("span", "", x[0]));
      (x[1] === "publish" || x[1] === "week" || x[1] === "month"
        ? secondary
        : box
      ).append(b);
    });
    var sign = node("div", "count panel");
    sign.append(
      node("strong", "", String(c.signups)),
      node("span", "", "Čeká na spuštění"),
    );
    secondary.append(sign);
    clear($("offer-counts"));
    S.categories.forEach(function (cat) {
      $("offer-counts").append(
        button(cat.name + " · " + c.offers[cat.code], function () {
          applyFilter({ entity: "help_offers", category: cat.code });
        }),
      );
    });
  }
  function aiBlock(row, detail) {
    var detailSerial = S.detailSerial;
    var box = node("div", "ai-block");
    box.append(
      node(
        "p",
        "kicker",
        row.classified_at
          ? "Potvrzeno: " +
              (row.classified_email || "administrátor") +
              " · " +
              when(row.classified_at)
          : "Návrh AI · vyžaduje kontrolu",
      ),
    );
    box.append(
      node(
        "p",
        "",
        row.ai_summary ||
          "Shrnutí zatím není k dispozici. Příběh můžete zpracovat ručně.",
      ),
    );
    box.append(node("p", "", category(row.category)));
    if (row.ai_help_type)
      box.append(node("p", "", "Navržená pomoc: " + row.ai_help_type));
    if (row.ai_model)
      box.append(node("p", "hint", row.ai_model + " · " + when(row.ai_at)));
    if (row.ai_error) box.append(node("p", "", "AI se nepodařilo spustit."));
    if (detail) {
      var run = button(
        row.ai_error
          ? "Zkusit znovu"
          : row.ai_at
            ? "Spustit znovu"
            : "Spustit AI",
        async function () {
          run.disabled = true;
          try {
            await api({ action: "ai", entity: row.entity, id: row.id });
            if (detailSerial === S.detailSerial) await openDetail(row);
            await loadList();
          } finally {
            run.disabled = !S.aiEnabled;
          }
        },
      );
      run.disabled = !S.aiEnabled;
      box.append(run);
      if (!S.aiEnabled)
        box.append(
          node(
            "p",
            "hint",
            "AI i přepis čekají na schválení advokátkou. Tlačítko je vypnuté.",
          ),
        );
    }
    return box;
  }
  function renderCards() {
    var box = $("admin-cards");
    clear(box);
    $("admin-count").textContent =
      S.total + " zpráv" + (S.filters.q ? " · výsledky hledání" : "");
    if (!S.rows.length)
      box.append(
        node("p", "panel", "Žádná zpráva neodpovídá zvoleným filtrům."),
      );
    S.rows.forEach(function (row) {
      var art = node(
        "article",
        "story-card" +
          (row.urgency === "acute" ? " is-acute" : "") +
          (S.detail && S.detail.id === row.id ? " is-selected" : ""),
      );
      art.append(aiBlock(row, false));
      var head = node("div", "card-head");
      head.append(
        node(
          "h2",
          "",
          row.anonymous ? "Anonymně" : row.full_name || "Bez jména",
        ),
      );
      art.append(head, tags(row), node("p", "meta", when(row.created_at)));
      if (row.delete_at && new Date(row.delete_at) - Date.now() < 14 * 864e5)
        art.append(
          node(
            "p",
            "hint",
            "Bude smazáno: " +
              when(row.delete_at) +
              " (po schválení retenčního režimu)",
          ),
        );
      art.append(
        button(
          "Otevřít zprávu",
          function () {
            return openDetail(row);
          },
          "card-open",
        ),
      );
      box.append(art);
    });
    $("prev-page").disabled = S.page === 0;
    $("next-page").disabled = (S.page + 1) * 25 >= S.total;
    $("page-info").textContent = "Strana " + (S.page + 1);
  }
  async function loadList() {
    var serial = ++S.serial;
    syncUrl();
    var data = await api({
      action: "list",
      filters: Object.assign({}, S.filters, { page: S.page }),
    });
    if (serial !== S.serial) return;
    S.rows = data.rows;
    S.total = data.total;
    renderCards();
  }
  function closeDetail() {
    S.detailSerial++;
    stopAudio($("admin-detail"));
    $("admin-detail").hidden = true;
    clear($("admin-detail"));
    $("admin-app").classList.remove("detail-open");
    S.detail = null;
  }
  function section(title) {
    var s = node("section", "section");
    s.append(node("h3", "", title));
    return s;
  }
  function consentSection(row) {
    var box = section("Souhlasy a věk");
    [
      ["Zpracování", row.consent, row.consent_at, "processing"],
      [
        "Přepis",
        Boolean(row.consent_transcript_at),
        row.consent_transcript_at,
        "transcript",
      ],
      ["Zveřejnění", row.consent_publish, row.consent_publish_at, "publish"],
      ["18+", row.age_confirmed, row.age_confirmed_at, "age"],
    ].forEach(function (x) {
      var r = node("div", "consent-row");
      r.append(
        node(
          "strong",
          "",
          x[0] + ": " + (x[1] ? "Ano" : "Nedoloženo / neuděleno"),
        ),
        node(
          "p",
          "hint",
          when(x[2]) + " · verze " + (row.consent_version || "nedoložena"),
        ),
      );
      var text = row.consent_texts && row.consent_texts[x[3]];
      if (text) r.append(node("p", "", text));
      box.append(r);
    });
    return box;
  }
  function askDelete(row) {
    var d = node("dialog");
    var title = node("h2", "", "Smazat všechny údaje osoby?");
    title.id = "delete-title";
    d.setAttribute("aria-labelledby", "delete-title");
    d.append(
      title,
      node(
        "p",
        "",
        "Smažou se místní záznamy této osoby, nahrávky, poznámky, páry a místní kopie e-mailů. Zprávy ve schránce Microsoft 365 zůstanou beze změny. Tuto akci nelze vrátit.",
      ),
      node("p", "", row.email),
    );
    var l = node("label", "", "Pro potvrzení napište SMAZAT"),
      input = node("input");
    input.id = "delete-confirm";
    l.htmlFor = input.id;
    d.append(l, input);
    var actions = node("div", "actions"),
      confirm = button(
        "Smazat osobu",
        async function () {
          confirm.disabled = true;
          try {
            await api({
              action: "person_erase",
              email: row.email,
              entity: row.entity,
              id: row.id,
              confirm: input.value,
            });
            d.close();
            closeDetail();
            await loadList();
            say("Údaje osoby byly smazány.");
          } catch (e) {
            error(e);
          } finally {
            confirm.disabled = input.value !== "SMAZAT";
          }
        },
        "danger",
      );
    confirm.disabled = true;
    input.addEventListener("input", function () {
      confirm.disabled = input.value !== "SMAZAT";
    });
    actions.append(
      button("Zrušit", function () {
        d.close();
      }),
      confirm,
    );
    d.append(actions);
    d.addEventListener("close", function () {
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  }
  function openPersonTools() {
    var d = node("dialog"),
      title = node("h2", "", "Údaje osoby podle e-mailu");
    title.id = "person-tools-title";
    d.setAttribute("aria-labelledby", title.id);
    var label = node("label", "", "Přesný e-mail osoby"),
      input = node("input");
    input.id = "person-tools-email";
    input.type = "email";
    input.maxLength = 254;
    label.htmlFor = input.id;
    d.append(
      title,
      node(
        "p",
        "",
        "Vyhledá příběhy, nabídky, registrace i místní kopie e-mailů. Neprovádí export ani výmaz ve schránce Microsoft 365. Před výmazem ověřte oprávněnost žádosti.",
      ),
      label,
      input,
    );
    function email() {
      if (!input.value || !input.reportValidity()) return null;
      return input.value.trim().toLowerCase();
    }
    var actions = node("div", "actions");
    actions.append(
      button("Exportovat ZIP", async function () {
        var e = email();
        if (e)
          downloadBlob(
            await api({ action: "person_export", email: e }, true),
            "osobni-udaje.zip",
          );
      }),
      button(
        "Smazat osobu",
        function () {
          var e = email();
          if (e) {
            d.close();
            askDelete({ email: e });
          }
        },
        "danger",
      ),
      button("Zavřít", function () {
        d.close();
      }),
    );
    d.append(actions);
    d.addEventListener("close", function () {
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  }
  async function openDetail(ref) {
    var detailSerial = ++S.detailSerial;
    var data = await api({ action: "detail", entity: ref.entity, id: ref.id });
    if (detailSerial !== S.detailSerial) return;
    var row = data.row;
    S.detail = row;
    var box = $("admin-detail");
    stopAudio(box);
    clear(box);
    box.hidden = false;
    $("admin-app").classList.add("detail-open");
    var head = node("div", "detail-top");
    head.append(
      node(
        "span",
        "kicker",
        row.entity === "stories" ? "Příběh" : "Nabídka pomoci",
      ),
      button("Zpět na přehled", function () {
        closeDetail();
        renderCards();
        $("admin-cards").querySelector("button")?.focus();
      }),
    );
    box.append(
      head,
      node("h2", "", row.anonymous ? "Anonymně" : row.full_name || "Bez jména"),
      tags(row),
      node("p", "meta", when(row.created_at)),
      aiBlock(row, true),
    );
    if (row.erasure_requested_at)
      box.append(
        node(
          "div",
          "crisis",
          "Výmaz této osoby čeká na dokončení. Zopakujte akci Smazat osobu.",
        ),
      );
    if (row.urgency === "acute")
      box.append(
        node(
          "div",
          "crisis",
          "Akutní případ — vyžaduje bezodkladné lidské posouzení. Platforma není krizová služba. Schválený postup a kontakty zatím nejsou doplněny.",
        ),
      );
    var edit = section("Další krok");
    var categoryChoices = S.categories.map(function (c) {
      return [c.code, c.name];
    });
    // An inactive category already assigned to this record must not silently become null.
    if (
      row.admin_category &&
      !categoryChoices.some(function (choice) {
        return choice[0] === row.admin_category;
      })
    ) {
      categoryChoices.push([
        row.admin_category,
        row.admin_category + " (neaktivní kategorie)",
      ]);
    }
    var cat = pick(
      "Kategorie",
      "edit-category",
      categoryChoices,
      row.admin_category,
      "Použít návrh AI",
    );
    var urgency = pick(
      "Naléhavost",
      "edit-urgency",
      Object.entries(URGENCIES),
      row.admin_urgency,
      "Použít návrh AI",
    );
    var status = pick(
      "Stav",
      "edit-status",
      Object.entries(STATUSES),
      row.status,
    );
    status.input.querySelector('option[value=""]').remove();
    var pub = status.input.querySelector('option[value="published"]');
    pub.disabled = !row.consent_publish || !row.age_confirmed;
    var grid = node("div", "edit-grid");
    grid.append(cat.wrap, urgency.wrap, status.wrap);
    edit.append(grid);
    if (pub.disabled)
      edit.append(
        node(
          "p",
          "hint",
          "Zveřejnění vyžaduje souhlas a doložené potvrzení 18+.",
        ),
      );
    var save = button(
      "Uložit změny",
      async function () {
        var patch = {};
        var nextCategory = cat.input.value || null;
        var nextUrgency = urgency.input.value || null;
        if (nextCategory !== (row.admin_category || null))
          patch.admin_category = nextCategory;
        if (nextUrgency !== (row.admin_urgency || null))
          patch.admin_urgency = nextUrgency;
        if (status.input.value !== row.status)
          patch.status = status.input.value;
        if (!Object.keys(patch).length) {
          say("Žádné změny k uložení.");
          return;
        }
        save.disabled = true;
        try {
          await api({
            action: "update",
            entity: row.entity,
            id: row.id,
            patch: patch,
          });
          say("Změny jsou uložené.");
          if (detailSerial === S.detailSerial) await openDetail(row);
          await loadList();
        } finally {
          save.disabled = false;
        }
      },
      "primary",
    );
    save.disabled = Boolean(row.erasure_requested_at);
    var bar = node("div", "save-bar actions");
    bar.append(save);
    edit.append(bar);
    box.append(edit);
    var story = section("Celá zpráva");
    story.append(node("p", "body-text", row.body || "Text není k dispozici."));
    if (row.audio_path) {
      var audio = null;
      var resumeAt = 0;
      var audioHint = node("p", "hint");
      audioHint.setAttribute("role", "status");
      var play = button("Přehrát nahrávku", async function () {
        play.disabled = true;
        if (audio) {
          resumeAt = audio.currentTime || resumeAt;
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        }
        try {
          var signed = await api({
            action: "audio",
            entity: row.entity,
            id: row.id,
          });
          if (detailSerial !== S.detailSerial || !story.isConnected) return;
          if (!audio) {
            audio = node("audio");
            audio.controls = true;
            audio.addEventListener("error", function () {
              if (!audio.isConnected || !audio.getAttribute("src")) return;
              resumeAt = audio.currentTime || resumeAt;
              play.disabled = false;
              play.textContent = "Obnovit přehrávání";
              audioHint.textContent =
                "Nahrávku se nepodařilo načíst. Obnovte přehrávání novým odkazem.";
            });
            story.append(audio, audioHint);
          }
          audio.addEventListener(
            "loadedmetadata",
            function () {
              if (resumeAt > 0 && Number.isFinite(audio.duration))
                audio.currentTime = Math.min(resumeAt, audio.duration);
            },
            { once: true },
          );
          audio.src = signed.url;
          audioHint.textContent = "";
          audio.play().catch(function () {});
          // URL TTL restricts future requests, not the duration of already loaded playback.
          // Closing the detail or signing out always stops and clears the player.
        } catch (e) {
          if (detailSerial === S.detailSerial) play.disabled = false;
          throw e;
        }
      });
      story.append(play);
    }
    if (row.transcript) {
      story.append(
        node("h3", "", "Přepis AI, může obsahovat chyby"),
        node("p", "body-text", row.transcript),
      );
    }
    box.append(story);
    var contact = section("Kontakt");
    if (row.anonymous)
      contact.append(
        node(
          "p",
          "hint",
          "Anonymita se týká zveřejnění. Kontakty jsou přístupné pouze administrátorům.",
        ),
      );
    contact.append(node("p", "", row.email));
    if (row.phone) contact.append(node("p", "", row.phone));
    contact.append(
      button("Kopírovat e-mail", async function () {
        await navigator.clipboard.writeText(row.email);
        say("E-mail zkopírován.");
      }),
    );
    var mail = node("a", "action", "Napsat e-mail");
    mail.href = "mailto:" + encodeURIComponent(row.email);
    contact.append(mail);
    if (row.links) {
      var links;
      try {
        links = JSON.parse(row.links);
      } catch {
        links = {};
      }
      Object.entries(links).forEach(function (pair) {
        try {
          var url = new URL(pair[1]);
          if (!["https:", "http:"].includes(url.protocol)) return;
          var a = node("a", "action", pair[0]);
          a.href = url.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          contact.append(a);
        } catch {}
      });
    }
    var template = node("details");
    template.append(node("summary", "", "Koncept odpovědi"));
    var ta = node("textarea");
    ta.setAttribute("aria-label", "Koncept odpovědi");
    ta.value =
      "Dobrý den, děkujeme za důvěru a za Vaši zprávu. Rádi bychom s Vámi ověřili, jakou pomoc nyní potřebujete a jaký další krok by pro Vás byl vhodný. Prosíme napište, zda a jak Vás můžeme bezpečně kontaktovat.";
    template.append(
      ta,
      button("Kopírovat koncept", async function () {
        await navigator.clipboard.writeText(ta.value);
        say("Koncept zkopírován. Před odesláním jej upravte.");
      }),
    );
    contact.append(template);
    box.append(contact, consentSection(row));
    if (row.admin_note) {
      var legacy = section("Původní interní poznámka");
      legacy.append(node("p", "body-text", row.admin_note));
      box.append(legacy);
    }
    var notes = section("Interní poznámky");
    data.notes.forEach(function (n) {
      var note = node("div", "note");
      note.append(
        node("p", "hint", n.author + " · " + when(n.created_at)),
        node("p", "body-text", n.body),
      );
      if (n.user_id === S.user.id)
        note.append(
          button("Upravit vlastní poznámku", function () {
            var area = node("textarea");
            area.setAttribute("aria-label", "Úprava poznámky");
            area.value = n.body;
            var saveNote = button("Uložit úpravu", async function () {
              saveNote.disabled = true;
              try {
                await api({
                  action: "note",
                  entity: row.entity,
                  id: row.id,
                  noteId: n.id,
                  body: area.value,
                });
                if (detailSerial === S.detailSerial) await openDetail(row);
              } finally {
                saveNote.disabled = false;
              }
            });
            note.append(area, saveNote);
          }),
        );
      notes.append(note);
    });
    var noteText = node("textarea");
    noteText.id = "new-note";
    noteText.maxLength = 5000;
    var noteLabel = node("label", "", "Nová poznámka");
    noteLabel.htmlFor = noteText.id;
    var add = button("Přidat poznámku", async function () {
      if (!noteText.value.trim()) {
        noteText.focus();
        return;
      }
      add.disabled = true;
      try {
        await api({
          action: "note",
          entity: row.entity,
          id: row.id,
          body: noteText.value,
        });
        if (detailSerial === S.detailSerial) await openDetail(row);
      } finally {
        add.disabled = false;
      }
    });
    notes.append(noteLabel, noteText, add);
    box.append(notes);
    var history = section("Historie stavů");
    if (!data.history.length)
      history.append(node("p", "hint", "Zatím bez změny stavu."));
    data.history.forEach(function (h) {
      history.append(
        node(
          "p",
          "",
          when(h.at) +
            " · " +
            h.author +
            " · " +
            (STATUSES[h.old_status] || h.old_status) +
            " → " +
            (STATUSES[h.new_status] || h.new_status),
        ),
      );
    });
    box.append(history);
    var matching = section("Párování pomoci");
    matching.append(
      node(
        "p",
        "hint",
        "Návrhy podle stejné kategorie. Vhodnost vždy ověřte osobně. Potvrzením se nikomu nic neodesílá.",
      ),
    );
    var shown = new Set();
    data.proposals.forEach(function (p) {
      shown.add(p.id);
      var m = data.matches.find(function (x) {
        return x.story_id === p.id || x.offer_id === p.id;
      });
      var card = node("div", "match");
      card.append(
        node("p", "", p.ai_summary || category(p.category)),
        node(
          "p",
          "hint",
          "Stav páru: " +
            (m
              ? {
                  confirmed: "Potvrzeno",
                  rejected: "Zamítnuto",
                  suggested: "Navrženo",
                }[m.status]
              : "Návrh"),
        ),
      );
      ["confirmed", "rejected"].forEach(function (v) {
        card.append(
          button(
            v === "confirmed" ? "Potvrdit pár" : "Zamítnout",
            async function () {
              await api({
                action: "match",
                entity: row.entity,
                id: row.id,
                otherId: p.id,
                status: v,
              });
              if (detailSerial === S.detailSerial) await openDetail(row);
            },
          ),
        );
      });
      matching.append(card);
    });
    data.matches.forEach(function (m) {
      var other = row.entity === "stories" ? m.offer_id : m.story_id;
      if (!shown.has(other))
        matching.append(
          node(
            "p",
            "hint",
            "Uložený pár " +
              other +
              " · " +
              {
                confirmed: "Potvrzeno",
                rejected: "Zamítnuto",
                suggested: "Navrženo",
              }[m.status],
          ),
        );
    });
    if (!data.proposals.length && !data.matches.length)
      matching.append(
        node("p", "hint", "Pro tuto kategorii zatím nemáme vhodný protějšek."),
      );
    box.append(matching);
    if (data.duplicates.length) {
      var dup = section("Další zprávy stejného kontaktu");
      dup.append(node("p", "hint", "Shoda e-mailu není důkaz totožnosti."));
      data.duplicates.forEach(function (d) {
        dup.append(
          button(
            (d.entity === "stories" ? "Příběh" : "Nabídka") +
              " · " +
              when(d.created_at),
            function () {
              return openDetail(d);
            },
          ),
        );
      });
      box.append(dup);
    }
    var gdpr = section("Údaje osoby");
    gdpr.append(
      node(
        "p",
        "hint",
        "Export a výmaz se vztahují na místní záznamy se stejným e-mailem v příbězích, nabídkách, registracích a kopiích e-mailů. Zprávy ve schránce Microsoft 365 se tím nemění.",
      ),
    );
    gdpr.append(
      button("Exportovat data osoby (ZIP)", async function () {
        downloadBlob(
          await api(
            { action: "person_export", entity: row.entity, id: row.id },
            true,
          ),
          "osobni-udaje.zip",
        );
      }),
      button(
        "Smazat osobu",
        function () {
          askDelete(row);
        },
        "danger",
      ),
    );
    box.append(gdpr);
    box.focus({ preventScroll: true });
    if (innerWidth < 1024) box.scrollIntoView({ block: "start" });
    renderCards();
  }
  var MAIL_STATUSES = {
    new: "Nový",
    in_progress: "V řešení",
    contacted: "Kontaktováno",
    archived: "Archiv",
  };
  var MAIL_TYPES = {
    story: "Příběh",
    help: "Nabídka pomoci",
    other: "Ostatní",
  };
  function mailApi(body, download) {
    return api(body, download, "/api/admin-mail/");
  }
  function mailSay(text) {
    $("mail-msg").textContent = text || "";
  }
  function mailError(e) {
    if (e && (e.name === "AbortError" || e.message === "cancelled")) return;
    if (S.view !== "mail" || !loadSession()) return;
    mailSay(
      e && (e.message === "ai_disabled" || e.message === "mail_ai_disabled")
        ? "AI nad e-maily čeká na schválení. Třídění můžete provést ručně."
        : "Akci s místní kopií e-mailu se nepodařilo dokončit. Zkuste to znovu.",
    );
  }
  function clearMail() {
    M.connectSerial++;
    M.connectBusy = false;
    clearMailInvite();
    $("mail-connection-status").textContent = "";
    $("mail-connect-msg").textContent = "";
    $("mail-connect-invite").disabled = true;
    $("mail-connect-disconnect").hidden = true;
    M.serial++;
    M.detailSerial++;
    M.pending.forEach(function (controller) {
      controller.abort();
    });
    M.pending.clear();
    M.rows = [];
    M.total = 0;
    M.detail = null;
    M.status = null;
    M.filters = {};
    M.page = 0;
    clear($("mail-cards"));
    clear($("mail-detail"));
    clear($("mail-filter-fields"));
    $("mail-detail").hidden = true;
    $("mail-workspace").classList.remove("mail-detail-open");
    $("mail-count").textContent = "";
    $("mail-page").textContent = "";
    $("mail-sync-status").textContent = "";
    $("mail-filters").open = false;
    mailSay("");
    document
      .querySelectorAll("dialog[data-mail-dialog]")
      .forEach(function (dialog) {
        if (dialog.open) dialog.close();
        dialog.remove();
      });
  }
  function setViewButtons() {
    document
      .querySelector(".skip")
      .setAttribute("href", S.view === "mail" ? "#mail-cards" : "#admin-cards");
    document.querySelectorAll("[data-admin-view]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.adminView === S.view));
    });
  }
  async function selectView(view) {
    if (!loadSession()) return;
    if (view === S.view) return;
    S.view = view;
    setViewButtons();
    $("admin-stories").hidden = view !== "stories";
    $("admin-mail").hidden = view !== "mail";
    if (view === "mail") {
      S.serial++;
      closeDetail();
      clear($("admin-cards"));
      S.rows = [];
      $("admin-filters").hidden = true;
      $("admin-filters-open").setAttribute("aria-expanded", "false");
      await loadMail();
    } else {
      clearMail();
      await loadList();
    }
  }
  function mailCategory(row) {
    return row.admin_category || row.category || row.ai_category || "";
  }
  function mailUrgency(row) {
    return row.admin_urgency || row.urgency || row.ai_urgency || "";
  }
  function mailWhen(row) {
    return row.last_received_at || row.received_at || row.created_at;
  }
  function mailSender(row) {
    return (
      [row.sender_name, row.sender_email].filter(Boolean).join(" · ") ||
      "Odesílatel není uveden"
    );
  }
  function mailTags(row) {
    var box = node("div", "tag-row"),
      urgency = mailUrgency(row);
    box.append(
      tag(MAIL_STATUSES[row.status] || "Nový"),
      tag(MAIL_TYPES[row.email_type] || "Nezařazeno"),
    );
    if (mailCategory(row)) box.append(tag(category(mailCategory(row))));
    if (urgency)
      box.append(tag(URGENCIES[urgency] || urgency, urgency === "acute"));
    return box;
  }
  function mailAiBlock(row) {
    var box = node("div", "ai-block");
    box.append(
      node(
        "p",
        "kicker",
        row.classified_at
          ? "Ruční zařazení · " + when(row.classified_at)
          : "Návrh AI · vyžaduje kontrolu",
      ),
    );
    box.append(
      node(
        "p",
        "",
        row.ai_summary ||
          "AI shrnutí zatím není k dispozici. E-mail můžete přečíst a zařadit ručně.",
      ),
    );
    if (row.ai_help_type)
      box.append(node("p", "", "Navržená pomoc: " + row.ai_help_type));
    if (row.ai_model)
      box.append(node("p", "hint", row.ai_model + " · " + when(row.ai_at)));
    if (row.ai_error) box.append(node("p", "", "AI se nepodařilo spustit."));
    return box;
  }
  function renderMailStatus(status) {
    M.status = status;
    var pieces = [];
    if (status.authMode === "delegated" && status.connected !== true)
      pieces.push("Načítání nových e-mailů čeká na připojení schránky.");
    else if (!status.configured || status.needsSetup)
      pieces.push("Připojení schránky čeká na dokončení nastavení.");
    else if (!status.syncEnabled)
      pieces.push("Načítání nových e-mailů je vypnuté.");
    else pieces.push("Načítání příchozích e-mailů je zapnuté.");
    pieces.push(
      status.lastSyncAt
        ? "Poslední načtení: " + when(status.lastSyncAt) + "."
        : "Zatím není doložené žádné načtení ze schránky.",
    );
    if (status.lastError)
      pieces.push(
        "Poslední načtení se nezdařilo; zobrazené kopie mohou být neúplné.",
      );
    $("mail-sync-status").textContent = pieces.join(" ");
    renderMailConnection(status);
  }
  function clearMailInvite() {
    if (M.inviteTimer) clearTimeout(M.inviteTimer);
    M.inviteTimer = null;
    M.inviteExpiresAt = 0;
    $("mail-connect-url").value = "";
    $("mail-connect-copy").disabled = true;
    $("mail-connect-expiry").textContent = "";
    $("mail-connect-link").hidden = true;
  }
  function inviteAllowed(status) {
    return (
      status &&
      status.authMode !== "certificate" &&
      status.connectConfigured === true &&
      status.connectInviteEnabled === true
    );
  }
  function updateMailConnectionButtons() {
    $("mail-connect-invite").disabled =
      M.connectBusy || !inviteAllowed(M.status);
    $("mail-connect-disconnect").hidden =
      !M.status ||
      M.status.authMode === "certificate" ||
      M.status.connected !== true;
    $("mail-connect-disconnect").disabled = M.connectBusy;
  }
  function renderMailConnection(status) {
    M.connectSerial++;
    M.connectBusy = false;
    clearMailInvite();
    var text;
    if (status.authMode === "certificate") {
      text = status.configured
        ? "Konfigurace správcovského certifikátu je připravená. Úspěšné čtení potvrzuje až poslední načtení zpráv. Připojovací odkazy se v tomto režimu nepoužívají."
        : "Připojení používá správcovský certifikát; jeho nastavení zatím není dokončené. Připojovací odkazy se v tomto režimu nepoužívají.";
    } else if (!status.connectConfigured) {
      text = "Čeká na nastavení Microsoft aplikace.";
      if (status.connected)
        text +=
          " Dřívější připojení je uložené, ale nastavení aplikace nyní není úplné.";
    } else if (status.connected) {
      text = "Připojení schránky je uložené.";
      if (status.connectionUpdatedAt)
        text +=
          " Poslední změna připojení: " +
          when(status.connectionUpdatedAt) +
          ".";
    } else {
      text =
        "Schránka zatím není připojená. Vytvořte odkaz a předejte jej osobě s přístupem ke schránce veryvera@nadbytecna.cz.";
    }
    if (
      status.authMode !== "certificate" &&
      status.connectConfigured &&
      !status.connectInviteEnabled
    )
      text += " Vytváření připojovacích odkazů zatím není povolené.";
    $("mail-connection-status").textContent = text;
    $("mail-connect-msg").textContent = "";
    updateMailConnectionButtons();
  }
  async function createMailInvite() {
    if (!inviteAllowed(M.status) || M.connectBusy) return;
    var epoch = S.authEpoch,
      serial = ++M.connectSerial;
    clearMailInvite();
    M.connectBusy = true;
    updateMailConnectionButtons();
    $("mail-connect-msg").textContent =
      "Připravuji soukromý připojovací odkaz…";
    try {
      var data = await mailApi({ action: "connect_invite" });
      if (
        epoch !== S.authEpoch ||
        serial !== M.connectSerial ||
        S.view !== "mail"
      )
        return;
      var expires = Date.parse(data.expiresAt),
        link;
      try {
        link = new URL(data.url);
      } catch {
        throw new Error("invalid_invite");
      }
      var localHttp =
        link.protocol === "http:" &&
        link.origin === location.origin &&
        ["localhost", "127.0.0.1"].includes(link.hostname);
      var sameOriginPreview =
        link.protocol === "https:" &&
        location.protocol === "https:" &&
        link.origin === location.origin &&
        link.hostname.endsWith(".vercel.app");
      var allowedOrigin =
        link.origin === "https://nadbytecna.cz" ||
        sameOriginPreview ||
        localHttp;
      if (
        !Number.isFinite(expires) ||
        expires <= Date.now() ||
        (!localHttp && link.protocol !== "https:") ||
        !allowedOrigin ||
        link.pathname !== "/api/mail-connect/" ||
        !/^#invite=[A-Za-z0-9_-]{43}$/.test(link.hash) ||
        link.search !== "" ||
        link.username ||
        link.password
      )
        throw new Error("invalid_invite");
      $("mail-connect-url").value = link.href;
      M.inviteExpiresAt = expires;
      $("mail-connect-expiry").textContent =
        "Platnost do " + when(data.expiresAt) + ". Odkaz je jednorázový.";
      $("mail-connect-link").hidden = false;
      $("mail-connect-copy").disabled = false;
      $("mail-connect-msg").textContent =
        "Odkaz je připravený pouze zde. Zkopírujte jej a předejte soukromě příjemci; účet v adminu nepotřebuje.";
      M.inviteTimer = setTimeout(
        function () {
          if (
            epoch !== S.authEpoch ||
            serial !== M.connectSerial ||
            S.view !== "mail"
          )
            return;
          clearMailInvite();
          $("mail-connect-msg").textContent =
            "Platnost připojovacího odkazu vypršela. Vytvořte nový.";
        },
        Math.min(2147483647, expires - Date.now()),
      );
    } catch (e) {
      if (
        epoch === S.authEpoch &&
        serial === M.connectSerial &&
        S.view === "mail" &&
        e.name !== "AbortError" &&
        e.message !== "cancelled"
      ) {
        clearMailInvite();
        $("mail-connect-msg").textContent =
          "Připojovací odkaz se nepodařilo připravit. Zkuste to znovu.";
      }
    } finally {
      if (
        epoch === S.authEpoch &&
        serial === M.connectSerial &&
        S.view === "mail"
      ) {
        M.connectBusy = false;
        updateMailConnectionButtons();
      }
    }
  }
  async function copyMailInvite() {
    if (
      !M.inviteExpiresAt ||
      M.inviteExpiresAt <= Date.now() ||
      !$("mail-connect-url").value
    ) {
      clearMailInvite();
      $("mail-connect-msg").textContent =
        "Odkaz už není dostupný. Vytvořte nový.";
      return;
    }
    var epoch = S.authEpoch,
      serial = M.connectSerial;
    try {
      await navigator.clipboard.writeText($("mail-connect-url").value);
      if (
        epoch === S.authEpoch &&
        serial === M.connectSerial &&
        S.view === "mail"
      )
        $("mail-connect-msg").textContent =
          "Odkaz zkopírován. Předejte jej soukromě určenému příjemci; automaticky se nic neodeslalo.";
    } catch {
      if (
        epoch === S.authEpoch &&
        serial === M.connectSerial &&
        S.view === "mail"
      )
        $("mail-connect-msg").textContent =
          "Kopírování se nepodařilo. Označte odkaz v poli a zkopírujte jej ručně.";
    }
  }
  function askDisconnectMail() {
    if (
      !M.status ||
      M.status.authMode === "certificate" ||
      M.status.connected !== true ||
      M.connectBusy
    )
      return;
    var d = node("dialog"),
      title = node("h2", "", "Odpojit načítání schránky?");
    d.dataset.mailDialog = "true";
    title.id = "mail-disconnect-title";
    d.setAttribute("aria-labelledby", title.id);
    var message = node("p");
    message.setAttribute("role", "status");
    d.append(
      title,
      node(
        "p",
        "",
        "Zruší se uložené připojení pro načítání e-mailů. Místní kopie i zprávy ve schránce Microsoft 365 zůstanou beze změny. Pro další načítání bude potřeba schránku znovu připojit.",
      ),
      message,
    );
    var actions = node("div", "actions"),
      confirm = button(
        "Odpojit schránku",
        async function () {
          var epoch = S.authEpoch,
            serial = ++M.connectSerial;
          M.connectBusy = true;
          confirm.disabled = true;
          clearMailInvite();
          updateMailConnectionButtons();
          try {
            await mailApi({ action: "disconnect", confirm: "ODPOJIT" });
            if (
              epoch !== S.authEpoch ||
              serial !== M.connectSerial ||
              S.view !== "mail"
            )
              return;
            d.close();
            renderMailStatus(Object.assign({}, M.status, { connected: false }));
            $("mail-connect-msg").textContent =
              "Načítání schránky bylo odpojeno. Žádné zprávy se nesmazaly.";
            var refreshSerial = M.connectSerial;
            try {
              var status = await mailApi({ action: "status" });
              if (
                epoch !== S.authEpoch ||
                refreshSerial !== M.connectSerial ||
                S.view !== "mail"
              )
                return;
              renderMailStatus(status);
              $("mail-connect-msg").textContent = status.connected
                ? "Aktuální stav připojení byl obnoven."
                : "Načítání schránky bylo odpojeno. Žádné zprávy se nesmazaly.";
            } catch (refreshError) {
              if (
                epoch === S.authEpoch &&
                refreshSerial === M.connectSerial &&
                S.view === "mail" &&
                refreshError.name !== "AbortError" &&
                refreshError.message !== "cancelled"
              )
                $("mail-connect-msg").textContent =
                  "Připojení bylo odpojeno. Aktuální stav se nepodařilo znovu načíst; použijte Obnovit přehled. Žádné zprávy se nesmazaly.";
            }
          } catch (e) {
            if (
              epoch === S.authEpoch &&
              serial === M.connectSerial &&
              S.view === "mail" &&
              e.name !== "AbortError" &&
              e.message !== "cancelled"
            )
              message.textContent =
                "Připojení se nepodařilo odpojit. Zkuste to znovu.";
          } finally {
            if (epoch === S.authEpoch && serial === M.connectSerial) {
              M.connectBusy = false;
              confirm.disabled = false;
              updateMailConnectionButtons();
            }
          }
        },
        "danger",
      );
    actions.append(
      button("Zrušit", function () {
        d.close();
      }),
      confirm,
    );
    d.append(actions);
    d.addEventListener("close", function () {
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  }
  function renderMailFilters() {
    var fields = $("mail-filter-fields");
    clear(fields);
    var searchWrap = node("div"),
      searchLabel = node("label", "", "Hledat v e-mailech"),
      search = node("input");
    search.id = "mail-search";
    search.type = "search";
    search.maxLength = 200;
    search.value = M.filters.q || "";
    searchLabel.htmlFor = search.id;
    searchWrap.append(searchLabel, search);
    fields.append(searchWrap);
    var timer;
    search.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (S.view !== "mail") return;
        M.filters.q = search.value;
        M.page = 0;
        closeMailDetail();
        loadMailList().catch(mailError);
      }, 300);
    });
    [
      ["status", "Stav", Object.entries(MAIL_STATUSES)],
      ["email_type", "Druh e-mailu", Object.entries(MAIL_TYPES)],
      [
        "category",
        "Kategorie",
        S.categories.map(function (c) {
          return [c.code, c.name];
        }),
      ],
      ["urgency", "Naléhavost", Object.entries(URGENCIES)],
    ].forEach(function (f) {
      var p = pick(f[1], "mail-filter-" + f[0], f[2], M.filters[f[0]]);
      p.input.addEventListener("change", function () {
        M.filters[f[0]] = p.input.value;
        M.page = 0;
        closeMailDetail();
        loadMailList().catch(mailError);
      });
      fields.append(p.wrap);
    });
  }
  function renderMailList() {
    var cards = $("mail-cards");
    clear(cards);
    $("mail-count").textContent = M.total + " e-mailových vláken";
    if (!M.rows.length)
      cards.append(
        node(
          "p",
          "panel",
          "Žádné místní e-mailové vlákno neodpovídá filtrům. Připojení schránky a poslední načtení vidíte výše.",
        ),
      );
    M.rows.forEach(function (row) {
      var article = node(
        "article",
        "story-card mail-card" +
          (mailUrgency(row) === "acute" ? " is-acute" : ""),
      );
      article.append(
        mailAiBlock(row),
        node("h2", "", row.subject || "Bez předmětu"),
        node("p", "mail-sender", mailSender(row)),
        node("p", "meta", when(mailWhen(row))),
        mailTags(row),
      );
      article.append(
        button(
          "Otevřít e-mailové vlákno",
          function () {
            return openMailDetail(row.id);
          },
          "card-open",
        ),
      );
      cards.append(article);
    });
    $("mail-prev").disabled = M.page === 0;
    $("mail-next").disabled = (M.page + 1) * 25 >= M.total;
    $("mail-page").textContent = "Strana " + (M.page + 1);
  }
  async function loadMailList() {
    var serial = ++M.serial;
    var data = await mailApi({
      action: "list",
      filters: Object.assign({}, M.filters, { page: M.page }),
    });
    if (serial !== M.serial || S.view !== "mail") return;
    if (
      !Array.isArray(data.rows) ||
      !Number.isFinite(Number(data.total)) ||
      Number(data.total) < 0
    )
      throw new Error("mail_list_invalid");
    M.rows = data.rows;
    M.total = Number(data.total);
    renderMailList();
  }
  async function loadMail() {
    var serial = ++M.serial;
    mailSay("Načítám místní kopie e-mailů…");
    var status = await mailApi({ action: "status" });
    if (serial !== M.serial || S.view !== "mail") return;
    renderMailStatus(status);
    renderMailFilters();
    await loadMailList();
    if (S.view === "mail") mailSay("");
  }
  function closeMailDetail() {
    M.detailSerial++;
    M.detail = null;
    clear($("mail-detail"));
    $("mail-detail").hidden = true;
    $("mail-workspace").classList.remove("mail-detail-open");
  }
  function askEraseMail(row) {
    var d = node("dialog"),
      title = node("h2", "", "Smazat místní kopii vlákna?");
    d.dataset.mailDialog = "true";
    title.id = "mail-erase-title";
    d.setAttribute("aria-labelledby", title.id);
    d.append(
      title,
      node(
        "p",
        "",
        "Smaže se místní kopie tohoto vlákna a jeho poznámky. Zprávy ve schránce Microsoft 365 zůstanou beze změny. Smazané vlákno se do tohoto přehledu znovu nenačte.",
      ),
      node("p", "body-text", row.subject || "Bez předmětu"),
    );
    var label = node("label", "", "Pro potvrzení napište SMAZAT"),
      input = node("input"),
      message = node("p");
    input.id = "mail-erase-confirm";
    label.htmlFor = input.id;
    message.setAttribute("role", "status");
    var actions = node("div", "actions"),
      erase = button(
        "Smazat místní kopii",
        async function () {
          var epoch = S.authEpoch;
          erase.disabled = true;
          try {
            await mailApi({
              action: "erase",
              id: row.id,
              confirm: input.value,
            });
            if (epoch !== S.authEpoch || S.view !== "mail") return;
            d.close();
            closeMailDetail();
            await loadMailList();
            mailSay(
              "Místní kopie vlákna byla smazána. Zprávy ve schránce Microsoft 365 zůstaly beze změny.",
            );
          } catch (e) {
            if (
              epoch === S.authEpoch &&
              S.view === "mail" &&
              e.name !== "AbortError" &&
              e.message !== "cancelled"
            )
              message.textContent =
                "Místní kopii se nepodařilo smazat. Zkuste to znovu.";
          } finally {
            if (epoch === S.authEpoch)
              erase.disabled = input.value !== "SMAZAT";
          }
        },
        "danger",
      );
    erase.disabled = true;
    input.addEventListener("input", function () {
      erase.disabled = input.value !== "SMAZAT";
    });
    actions.append(
      button("Zrušit", function () {
        d.close();
      }),
      erase,
    );
    d.append(label, input, message, actions);
    d.addEventListener("close", function () {
      d.remove();
    });
    document.body.append(d);
    d.showModal();
  }
  async function openMailDetail(id, messagePage) {
    messagePage = Math.max(0, Math.floor(Number(messagePage) || 0));
    var serial = ++M.detailSerial;
    var data = await mailApi({
      action: "detail",
      id: id,
      message_page: messagePage,
    });
    if (serial !== M.detailSerial || S.view !== "mail") return;
    var row = data.thread,
      box = $("mail-detail");
    if (!row) throw new Error("missing");
    M.detail = row;
    clear(box);
    box.hidden = false;
    $("mail-workspace").classList.add("mail-detail-open");
    var head = node("div", "detail-top");
    head.append(
      node("span", "kicker", "Místní kopie e-mailu"),
      button("Zpět na e-maily", function () {
        closeMailDetail();
        $("mail-cards").querySelector("button")?.focus();
      }),
    );
    box.append(
      head,
      node("h2", "", row.subject || "Bez předmětu"),
      node("p", "mail-sender", mailSender(row)),
      node("p", "meta", when(mailWhen(row))),
      mailTags(row),
      mailAiBlock(row),
    );
    if (mailUrgency(row) === "acute")
      box.append(
        node(
          "div",
          "crisis",
          "Akutní případ — vyžaduje bezodkladné lidské posouzení. Platforma není krizová služba.",
        ),
      );
    var run = button(
      row.ai_error
        ? "Zkusit AI znovu"
        : row.ai_at
          ? "Spustit AI znovu"
          : "Spustit AI nad e-mailem",
      async function () {
        run.disabled = true;
        try {
          await mailApi({ action: "ai", id: row.id });
          if (serial !== M.detailSerial || S.view !== "mail") return;
          await openMailDetail(row.id);
          await loadMailList();
        } finally {
          if (serial === M.detailSerial) run.disabled = !M.status?.aiEnabled;
        }
      },
    );
    run.disabled = !M.status?.aiEnabled;
    box.append(run);
    box.append(
      node(
        "p",
        "hint",
        "Návrh AI vychází nejvýše z 20 nejnovějších zpráv a 20 000 znaků. U dlouhého vlákna zkontrolujte také starší zprávy.",
      ),
    );
    if (!M.status?.aiEnabled)
      box.append(
        node(
          "p",
          "hint",
          "AI nad e-maily je vypnutá a čeká na schválení. Kategorie, naléhavost i stav můžete nastavit ručně.",
        ),
      );
    var mailCategoryChoices = S.categories.map(function (c) {
      return [c.code, c.name];
    });
    if (
      row.admin_category &&
      !mailCategoryChoices.some(function (choice) {
        return choice[0] === row.admin_category;
      })
    ) {
      mailCategoryChoices.push([
        row.admin_category,
        row.admin_category + " (neaktivní kategorie)",
      ]);
    }
    var edit = section("Zařazení a další krok"),
      kind = pick(
        "Druh e-mailu",
        "mail-edit-type",
        Object.entries(MAIL_TYPES),
        row.email_type,
      ),
      cat = pick(
        "Kategorie",
        "mail-edit-category",
        mailCategoryChoices,
        row.admin_category,
        "Použít návrh AI",
      ),
      urgency = pick(
        "Naléhavost",
        "mail-edit-urgency",
        Object.entries(URGENCIES),
        row.admin_urgency,
        "Použít návrh AI",
      ),
      status = pick(
        "Stav",
        "mail-edit-status",
        Object.entries(MAIL_STATUSES),
        row.status || "new",
      );
    kind.input.querySelector('option[value=""]').textContent = "Nezařazeno";
    status.input.querySelector('option[value=""]').remove();
    var grid = node("div", "edit-grid");
    grid.append(kind.wrap, cat.wrap, urgency.wrap, status.wrap);
    edit.append(
      grid,
      node(
        "p",
        "hint",
        "Zařazení e-mailu samo o sobě neuděluje souhlas se zveřejněním a nevytváří veřejný příběh.",
      ),
    );
    var save = button(
      "Uložit zařazení e-mailu",
      async function () {
        var patch = {};
        if (status.input.value !== (row.status || "new"))
          patch.status = status.input.value;
        if (kind.input.value && kind.input.value !== row.email_type)
          patch.email_type = kind.input.value;
        if ((cat.input.value || null) !== (row.admin_category || null))
          patch.admin_category = cat.input.value || null;
        if ((urgency.input.value || null) !== (row.admin_urgency || null))
          patch.admin_urgency = urgency.input.value || null;
        if (!Object.keys(patch).length) {
          mailSay("Zařazení e-mailu se nezměnilo.");
          return;
        }
        save.disabled = true;
        try {
          await mailApi({ action: "update", id: row.id, patch: patch });
          if (serial !== M.detailSerial || S.view !== "mail") return;
          await openMailDetail(row.id);
          await loadMailList();
          mailSay("Zařazení místní kopie e-mailu je uložené.");
        } finally {
          if (serial === M.detailSerial) save.disabled = false;
        }
      },
      "primary",
    );
    var bar = node("div", "save-bar actions");
    bar.append(save);
    edit.append(bar);
    box.append(edit);
    var messages = section("Zprávy ve vlákně");
    var messageCount = Number.isFinite(Number(data.message_count))
      ? Number(data.message_count)
      : data.messages?.length || 0;
    var currentMessagePage = Number.isFinite(Number(data.message_page))
      ? Number(data.message_page)
      : messagePage;
    if (messageCount > 20 || data.messages_truncated)
      messages.append(
        node(
          "p",
          "mail-notice",
          "Stránka " +
            (currentMessagePage + 1) +
            " z " +
            Math.ceil(messageCount / 20) +
            ". Ve vlákně je celkem " +
            messageCount +
            " zpráv. Zobrazujeme je po 20 od nejnovějších; starší zprávy otevřete tlačítkem níže.",
        ),
      );
    (Array.isArray(data.messages) ? data.messages : []).forEach(function (m) {
      var article = node("article", "mail-message");
      article.append(
        node("h3", "", m.subject || row.subject || "Zpráva"),
        node(
          "p",
          "meta",
          mailSender(m) + " · " + when(m.received_at || m.created_at),
        ),
        node("p", "body-text", m.body_text || "Text zprávy není k dispozici."),
      );
      messages.append(article);
    });
    if (!data.messages?.length)
      messages.append(
        node("p", "hint", "V místní kopii zatím nejsou uložené zprávy."),
      );
    if (messageCount > 20) {
      var messagePager = node("nav", "pager");
      messagePager.setAttribute("aria-label", "Stránkování zpráv ve vlákně");
      var newer = button("Novější zprávy", function () {
        return openMailDetail(row.id, currentMessagePage - 1);
      });
      var older = button("Starší zprávy", function () {
        return openMailDetail(row.id, currentMessagePage + 1);
      });
      newer.disabled = currentMessagePage === 0;
      older.disabled = (currentMessagePage + 1) * 20 >= messageCount;
      messagePager.append(
        newer,
        node(
          "span",
          "",
          currentMessagePage + 1 + " / " + Math.ceil(messageCount / 20),
        ),
        older,
      );
      messages.append(messagePager);
    }
    box.append(messages);
    var notes = section("Interní poznámky k e-mailu");
    (Array.isArray(data.notes) ? data.notes : []).forEach(function (n) {
      var note = node("div", "note");
      note.append(
        node(
          "p",
          "hint",
          (n.author || "Administrátor") + " · " + when(n.created_at || n.at),
        ),
        node("p", "body-text", n.body || n.text || ""),
      );
      notes.append(note);
    });
    var noteLabel = node("label", "", "Nová poznámka k e-mailu"),
      noteText = node("textarea");
    noteText.id = "mail-new-note";
    noteText.maxLength = 5000;
    noteLabel.htmlFor = noteText.id;
    var add = button("Přidat poznámku k e-mailu", async function () {
      if (!noteText.value.trim()) {
        noteText.focus();
        return;
      }
      add.disabled = true;
      try {
        await mailApi({ action: "note", id: row.id, text: noteText.value });
        if (serial !== M.detailSerial || S.view !== "mail") return;
        await openMailDetail(row.id);
      } finally {
        if (serial === M.detailSerial) add.disabled = false;
      }
    });
    notes.append(noteLabel, noteText, add);
    box.append(notes);
    var privacy = section("Místní kopie a údaje");
    privacy.append(
      node(
        "p",
        "hint",
        "Tyto akce zahrnují pouze toto vlákno uložené v adminu. Neprovádějí export ani výmaz ze schránky Microsoft 365. Žádost vztahující se ke všem záznamům osoby vyřiďte přes Údaje osoby.",
      ),
    );
    var exportButton = button(
      "Exportovat místní vlákno (JSON)",
      async function () {
        var epoch = S.authEpoch;
        exportButton.disabled = true;
        try {
          var blob = await mailApi({ action: "export", id: row.id }, true);
          if (epoch !== S.authEpoch || S.view !== "mail") return;
          downloadBlob(blob, "emailove-vlakno.json");
        } finally {
          if (epoch === S.authEpoch) exportButton.disabled = false;
        }
      },
    );
    privacy.append(
      exportButton,
      button(
        "Smazat místní kopii vlákna",
        function () {
          askEraseMail(row);
        },
        "danger",
      ),
    );
    box.append(privacy);
    box.focus({ preventScroll: true });
    if (innerWidth < 1024) box.scrollIntoView({ block: "start" });
  }
  async function load() {
    var data = await api({ action: "init" });
    S.categories = data.categories;
    S.user = data.user;
    S.aiEnabled = data.aiEnabled;
    $("admin-login").hidden = true;
    $("admin-app").hidden = false;
    $("admin-out").hidden = false;
    renderCounts(data.counts);
    readUrl();
    renderFilters();
    await loadList();
    say("");
  }
  async function sendLink() {
    var email = $("admin-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    var c = cfg();
    if (!c.url || !c.key) {
      say("Přihlášení není nakonfigurované.");
      return;
    }
    var p = await challenge();
    if (!global.NadbytecnaAdminPkce || !global.NadbytecnaAdminPkce.save(p.verifier)) {
      say("Pro přihlášení povolte úložiště tohoto webu v prohlížeči.");
      return;
    }
    var r = await authFetch(
      "/auth/v1/otp?redirect_to=" +
        encodeURIComponent(location.origin + "/admin/"),
      {
        method: "POST",
        body: JSON.stringify({
          email: email,
          create_user: true,
          code_challenge: p.challenge,
          code_challenge_method: "s256",
        }),
      },
    );
    say(
      r.ok
        ? "Pokud máte přístup, přijde vám přihlašovací odkaz. Otevřete poslední odkaz v tomto prohlížeči do 15 minut."
        : "Odkaz se nepodařilo poslat. Zkuste to později.",
    );
  }
  async function boot() {
    var p = new URLSearchParams(location.search),
      code = p.get("code");
    if (code) {
      var v = global.NadbytecnaAdminPkce && global.NadbytecnaAdminPkce.read();
      history.replaceState({}, "", "/admin/");
      if (v) {
        saveSession(asSession(await tokenFromCode(code, v)));
        global.NadbytecnaAdminPkce.clear(v);
      }
      else
        say("Přihlašovací odkaz vypršel nebo je otevřený v jiném prohlížeči. Požádejte zde o nový odkaz.");
    }
    if (await current()) await load();
  }
  function closeFilters() {
    var box = $("admin-filters");
    box.hidden = true;
    box.inert = false;
    $("admin-filters-open").setAttribute("aria-expanded", "false");
    $("admin-filters-open").focus();
  }
  $("admin-filters-open").addEventListener("click", function () {
    var box = $("admin-filters");
    box.hidden = false;
    $("admin-filters-open").setAttribute("aria-expanded", "true");
    $("admin-filters-close").focus();
  });
  $("admin-filters-close").addEventListener("click", closeFilters);
  document.addEventListener("keydown", function (e) {
    if ($("admin-filters").hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeFilters();
    }
    if (e.key === "Tab" && innerWidth < 768) {
      var nodes = [
          ...$("admin-filters").querySelectorAll("button,input,select"),
        ].filter(function (n) {
          return !n.disabled;
        }),
        first = nodes[0],
        last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = $("admin-send");
    b.disabled = true;
    sendLink()
      .catch(error)
      .finally(function () {
        b.disabled = false;
      });
  });
  $("admin-out").addEventListener("click", function () {
    logout();
    say("Jste odhlášeni.");
  });
  $("admin-reset").addEventListener("click", function () {
    applyFilter({});
  });
  $("admin-sort").addEventListener("change", function () {
    S.filters.sort = this.value;
    S.page = 0;
    loadList().catch(error);
  });
  document.querySelectorAll("[data-entity]").forEach(function (b) {
    b.addEventListener("click", function () {
      S.filters.entity = b.dataset.entity;
      S.page = 0;
      closeDetail();
      renderFilters();
      loadList().catch(error);
    });
  });
  $("prev-page").addEventListener("click", function () {
    if (S.page > 0) {
      S.page--;
      closeDetail();
      loadList().catch(error);
    }
  });
  $("next-page").addEventListener("click", function () {
    S.page++;
    closeDetail();
    loadList().catch(error);
  });
  $("admin-csv").addEventListener("click", async function () {
    var b = this;
    b.disabled = true;
    try {
      downloadBlob(
        await api(
          {
            action: "csv",
            filters: S.filters,
            includeText: $("csv-text").checked,
          },
          true,
        ),
        "nadbytecna.csv",
      );
    } catch (e) {
      error(e);
    } finally {
      b.disabled = false;
    }
  });
  $("admin-person").addEventListener("click", openPersonTools);
  document.querySelectorAll("[data-admin-view]").forEach(function (b) {
    b.addEventListener("click", function () {
      selectView(b.dataset.adminView).catch(mailError);
    });
  });
  $("mail-connect-invite").addEventListener("click", createMailInvite);
  $("mail-connect-copy").addEventListener("click", copyMailInvite);
  $("mail-connect-disconnect").addEventListener("click", askDisconnectMail);
  $("mail-refresh").addEventListener("click", function () {
    closeMailDetail();
    loadMail().catch(mailError);
  });
  $("mail-reset").addEventListener("click", function () {
    M.filters = {};
    M.page = 0;
    closeMailDetail();
    renderMailFilters();
    loadMailList().catch(mailError);
  });
  $("mail-prev").addEventListener("click", function () {
    if (M.page > 0) {
      M.page--;
      closeMailDetail();
      loadMailList().catch(mailError);
    }
  });
  $("mail-next").addEventListener("click", function () {
    M.page++;
    closeMailDetail();
    loadMailList().catch(mailError);
  });
  boot().catch(error);
})(window);
