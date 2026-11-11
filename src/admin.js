// Obsah zpráv zůstává v paměti stránky; přihlášení má pevný limit 30 dní.
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
  function quantity(count, one, few, many) {
    return count + " " + (count === 1 ? one : count >= 2 && count <= 4 ? few : many);
  }
  function hasFilters(filters) {
    return Object.keys(filters).some(function (key) {
      return key !== "sort" && filters[key] !== "" && filters[key] != null;
    });
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
  async function challenge(verifier) {
    if (!verifier) {
      var bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      verifier = b64url(bytes);
    }
    var digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    return { verifier: verifier, challenge: b64url(new Uint8Array(digest)) };
  }
  function loadSession() {
    return global.NadbytecnaAdminSession.load();
  }
  function saveSession(s) {
    global.NadbytecnaAdminSession.save(s);
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
  function asSession(data, previous) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 15000,
      remember_until: previous && previous.remember_until || Date.now() + 30 * 24 * 3600e3,
    };
  }
  var refreshing = null;
  async function currentUnlocked() {
    var epoch = S.authEpoch;
    var s = loadSession();
    if (!s || !s.access_token) return null;
    if (s.expires_at && s.expires_at < Date.now() && s.refresh_token) {
      s = asSession(await refresh(s), s);
      if (epoch !== S.authEpoch || !loadSession()) return null;
      saveSession(s);
    }
    return s;
  }
  function current() {
    if (refreshing) return refreshing;
    var run = function () { return currentUnlocked(); };
    var locks = global.navigator && global.navigator.locks;
    refreshing = (locks ? locks.request("nadbytecna-admin-refresh", run) : run())
      .finally(function () { refreshing = null; });
    return refreshing;
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
    filters: {disposition:"normal"},
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
    document.body.classList.remove("client-mode");
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
  async function logout(remote) {
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
    $("admin-shop").hidden = true;
    clear($("shop-body"));
    stopShopTimer();
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
    if (s && remote !== true) {
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
    if (S.user && !loadSession()) {
      logout();
      say("Platnost přihlášení skončila. Přihlaste se znovu.");
    }
  }, 30000);
  global.addEventListener("storage", function (event) {
    if ((event.key === sessionKey || event.key === null) && !loadSession()) {
      logout(true);
      say("Jste odhlášeni.");
    }
  });
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
    clear($("story-search-slot"));
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
      (f[0] === "q" ? $("story-search-slot") : box).append(wrap);
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
          : row.ai_at || row.ai_summary || row.ai_help_type
            ? "Návrh AI · vyžaduje kontrolu"
            : "Zatím bez shrnutí AI",
      ),
    );
    box.append(
      node(
        "p",
        "",
        row.ai_summary ||
          "Shrnutí zatím není k dispozici. Zprávu můžete přečíst a zařadit ručně.",
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
      quantity(S.total, "zpráva", "zprávy", "zpráv") + (S.filters.q ? " · výsledky hledání" : "");
    if (!S.rows.length) {
      var empty = node("div", "panel");
      empty.append(node("p", "", S.page > 0
        ? "Na této stránce už nejsou žádné zprávy."
        : hasFilters(S.filters)
          ? "Žádná zpráva neodpovídá zvoleným filtrům."
          : "Zatím tu není žádný příběh ani nabídka pomoci. Po odeslání formuláře se zpráva objeví zde."));
      if (S.page > 0)
        empty.append(button("Zpět na první stránku", function () {
          S.page = 0;
          loadList().catch(error);
        }));
      else if (hasFilters(S.filters))
        empty.append(button("Zrušit filtry", function () { applyFilter({}); }));
      box.append(empty);
    }
    S.rows.forEach(function (row) {
      var name=row.anonymous ? "Anonymně" : row.full_name || "Bez jména";
      var art=global.NadbytecnaAdminLayout.row({id:row.id,name:name,
        title:row.category ? category(row.category) : row.entity === "stories" ? "Sdílený příběh" : "Nabídka pomoci",
        preview:row.preview || row.ai_summary || (row.input_type === "recording" ? "Hlasová zpráva · přehrání v detailu" : row.input_type === "upload" ? "Nahraný zvukový soubor" : "Otevřít celý text zprávy"),
        at:row.created_at,when:when(row.created_at),status:STATUSES[row.status]||row.status,
        acute:row.urgency === "acute",warning:row.erasure_requested_at ? "Výmaz čeká" : row.urgency === "acute" ? "Akutní" : "",
        media:row.input_type === "recording" ? "Hlasovka" : row.input_type === "upload" ? "Soubor" : ""
      },button("Otevřít zprávu",function(){return openDetail(row);},"card-open"));
      box.append(art);
    });
    global.NadbytecnaAdminLayout.selected(box,S.detail?.id);
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
    if (!S.detail && innerWidth >= 1024 && S.view === "stories" && S.rows.length) await openDetail(S.rows[0], true);
  }
  function closeDetail() {
    S.detailSerial++;
    stopAudio($("admin-detail"));
    $("admin-detail").hidden = true;
    clear($("admin-detail"));
    $("admin-app").classList.remove("detail-open");
    S.detail = null;
    global.NadbytecnaAdminLayout.selected($("admin-cards"),null);
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
  async function openDetail(ref, automatic) {
    var previousUi=S.detail?.id === ref.id ? global.NadbytecnaAdminLayout.state($("admin-detail")) : null;
    var keyboardSelection=global.NadbytecnaAdminLayout.keyboard();
    var keepListFocus=automatic || keyboardSelection;
    var detailSerial = ++S.detailSerial;
    var pendingBox=$("admin-detail");
    stopAudio(pendingBox);
    clear(pendingBox);
    pendingBox.hidden=true;
    S.detail=ref;
    var data;
    try { data = await api({ action: "detail", entity: ref.entity, id: ref.id }); }
    catch(e){if(detailSerial===S.detailSerial)closeDetail();throw e;}
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
    if (row.entity === "stories") {
      var pdfButton = button("Stáhnout PDF", async function () {
        var epoch = S.authEpoch;
        pdfButton.disabled = true;
        try {
          var blob = await api({ action: "story_pdf", entity: row.entity, id: row.id }, true);
          if (epoch !== S.authEpoch) return;
          downloadBlob(blob, "pribeh-" + row.id.slice(0, 8) + ".pdf");
        } finally {
          if (pdfButton.isConnected) pdfButton.disabled = Boolean(row.erasure_requested_at);
        }
      }, "story-pdf-download");
      pdfButton.disabled = Boolean(row.erasure_requested_at);
      head.append(pdfButton);
    }
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
    story.append(node("p", "body-text", row.body || (row.audio_path ? "Zpráva je uložená jako zvuková nahrávka." : "Text není k dispozici.")));
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
    if (row.greeting) {
      contact.append(node("p", "hint", "Anonymní oslovení"));
      contact.append(node("p", "", row.greeting));
    }
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
    global.NadbytecnaAdminLayout.detail(box,"story",previousUi);
    global.NadbytecnaAdminLayout.selected($("admin-cards"),row.id);
    if (!keepListFocus) box.focus({ preventScroll: true });
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
  var MAIL_SUBTYPES = {
    personal_story: "Osobní příběh",
    request_help: "Žádost o pomoc",
    offer_help: "Nabídka pomoci",
    press: "Média",
    partnership: "Spolupráce",
    operational: "Organizační pošta",
    automated: "Automatická zpráva",
    spam: "Spam / podezřelá pošta",
    other: "Ostatní",
  };
  var MAIL_CONFIDENCES = { low: "nižší", medium: "střední", high: "vyšší" };
  function mailReviewed(row) {
    return Number.isInteger(row.revision) && row.revision > 0 &&
      row.reviewed_revision === row.revision;
  }
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
        : e && e.message === "mail_archive_cleanup_pending"
          ? "Přístup k originálům je zablokovaný. Dokončuje se jejich bezpečné odstranění; výmaz zatím není hotový. Zkuste jej znovu za několik minut."
          : e && e.message === "archive_not_ready"
            ? "Originál zatím není uložený. Zkontrolujte stav zálohy a zkuste to později."
            : e && e.message === "mail_ai_scope_required"
              ? "Vlákno není povolené pro AI. Ověřte projektový obsah a nastavte jeho rozsah AI."
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
    M.filters = {disposition:"normal"};
    M.page = 0;
    clear($("mail-cards"));
    clear($("mail-detail"));
    clear($("mail-filter-fields"));
    $("mail-detail").hidden = true;
    $("mail-workspace").classList.remove("mail-detail-open");
    $("mail-count").textContent = "";
    $("mail-page").textContent = "";
    $("mail-sync-status").textContent = "";
    clear($("mail-triage-stats"));
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
      .setAttribute("href", S.view === "mail" ? "#mail-cards" : S.view === "shop" ? "#shop-body" : "#admin-cards");
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
    $("admin-shop").hidden = view !== "shop";
    if (view !== "shop") stopShopTimer();
    if (view === "shop") {
      S.serial++;
      closeDetail();
      clearMail();
      await loadShop(false);
    } else if (view === "mail") {
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
  var SVGNS = "http://www.w3.org/2000/svg";
  function money(n, cur) {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: cur || "CZK", maximumFractionDigits: 0 }).format(n || 0);
  }
  function barChart(rows, key, label, fmt) {
    fmt = fmt || function (r) { return r.day.slice(8, 10) + ". " + r.day.slice(5, 7) + "."; };
    var W = 720, H = 140, max = Math.max.apply(null, rows.map(function (r) { return r[key]; }).concat([1]));
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + (H + 18));
    svg.setAttribute("class", "shop-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    var step = W / rows.length;
    rows.forEach(function (r, i) {
      var h = Math.round((r[key] / max) * H);
      var bar = document.createElementNS(SVGNS, "rect");
      var bw = Math.max(1, Math.min(Math.round(step - 4), 48));
      bar.setAttribute("x", String(Math.round(i * step + (step - bw) / 2)));
      bar.setAttribute("y", String(H - h));
      bar.setAttribute("width", String(bw));
      bar.setAttribute("height", String(Math.max(h, r[key] > 0 ? 2 : 0)));
      bar.setAttribute("rx", "2");
      var t = document.createElementNS(SVGNS, "title");
      t.textContent = fmt(r) + " — " + r[key];
      bar.append(t);
      svg.append(bar);
    });
    var a = document.createElementNS(SVGNS, "text");
    a.setAttribute("x", "0");
    a.setAttribute("y", String(H + 14));
    a.textContent = fmt(rows[0]);
    var z = document.createElementNS(SVGNS, "text");
    z.setAttribute("x", String(W));
    z.setAttribute("y", String(H + 14));
    z.setAttribute("text-anchor", "end");
    z.textContent = fmt(rows[rows.length - 1]);
    svg.append(a, z);
    return svg;
  }
  var shopTimer = 0;
  function eur(n) {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n || 0);
  }
  function cur(amount, code) {
    return code === "EUR" ? eur(amount) : money(amount, code);
  }
  function currencySplit(by) {
    var parts = Object.keys(by || {}).map(function (k) {
      return cur(by[k].amount, k) + " (" + by[k].orders + ")";
    });
    return parts.length ? parts.join(" · ") : "—";
  }
  function ago(iso) {
    if (!iso) return "zatím žádný";
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 90) return "před " + s + " s";
    if (s < 5400) return "před " + Math.round(s / 60) + " min";
    return when(iso);
  }
  function rankList(rows, label) {
    var box = node("div", "shop-rank");
    var max = Math.max.apply(null, rows.map(function (r) { return r.orders; }).concat([1]));
    if (!rows.length) box.append(node("p", "hint", "Zatím bez dat."));
    rows.forEach(function (r) {
      var row = node("div", "shop-rank-row");
      var bar = node("progress");
      bar.max = max;
      bar.value = r.orders;
      bar.setAttribute("aria-label", label + " " + r.key + ": " + r.orders);
      row.append(node("span", "", r.key), bar, node("strong", "", String(r.orders)));
      box.append(row);
    });
    return box;
  }
  function block(title, child, hint) {
    var b = node("section", "shop-block");
    b.append(node("h3", "", title));
    if (hint) b.append(node("p", "hint", hint));
    b.append(child);
    return b;
  }
  function kpi(label, value, sub) {
    var c = node("div", "panel count shop-kpi");
    c.append(node("span", "", label), node("strong", "", value));
    if (sub) c.append(node("span", "hint", sub));
    return c;
  }
  function grid(cards) {
    var g = node("div", "counts");
    cards.forEach(function (c) { g.append(c); });
    return g;
  }
  function renderShop(d) {
    var body = $("shop-body");
    clear(body);
    var t = d.today, all = d.total;
    $("shop-meta").textContent = "Aktualizováno " + when(d.generatedAt) + " · poslední webhook " + ago(d.sync && d.sync.last_webhook_at) + " · poslední dorovnání " + ago(d.sync && d.sync.last_reconcile_at);
    if (d.last) {
      var last = node("p", "shop-last");
      last.append(node("strong", "", "Poslední objednávka "), document.createTextNode(d.last.name + " · " + when(d.last.at) + " · " + cur(d.last.total, d.last.currency) + (d.last.country ? " · " + d.last.country : "")));
      body.append(last);
    }
    body.append(block("Dnes", grid([
      kpi("Objednávky", String(t.orders), "dnešní den v Praze"),
      kpi("Obrat", money(t.czk, "CZK"), currencySplit(t.by_currency)),
      kpi("Prodané kusy", String(t.units), "EDP nadbytečná 50 ml"),
      kpi("Průměrná objednávka", money(t.average_czk, "CZK"), "v Kč"),
    ])));
    body.append(block("Od spuštění (11. 11. 2026)", grid([
      kpi("Objednávky", String(all.orders)),
      kpi("Obrat", money(all.czk, "CZK"), currencySplit(all.by_currency)),
      kpi("Prodané kusy", String(all.units)),
      kpi("Průměrná objednávka", money(all.average_czk, "CZK")),
    ]), "Obrat v Kč je přepočet Shopify podle jeho kurzu v den objednávky. Bez zrušených a testovacích objednávek."));
    if (d.daily.length) body.append(block("Obrat po dnech (Kč)", barChart(d.daily, "czk", "Obrat po dnech v Kč")));
    var hours = d.hourly.map(function (h) { return { day: "0000-00-" + String(h.hour).padStart(2, "0"), hour: h.hour, orders: h.orders }; });
    body.append(block("Objednávky podle hodiny dne", barChart(hours, "orders", "Objednávky podle hodiny dne", function (r) { return r.hour + ":00"; }), "Pražský čas, od spuštění. Zleva 0:00, zprava 23:00."));
    body.append(block("Česko a Slovensko", grid([
      kpi("Česko", d.countries.CZ.orders + " obj.", money(d.countries.CZ.czk, "CZK") + " · průměr " + money(d.countries.CZ.average_czk, "CZK")),
      kpi("Slovensko", d.countries.SK.orders + " obj.", currencySplit(d.countries.SK.by_currency) + " · v Kč " + money(d.countries.SK.czk, "CZK")),
    ])));
    var st = d.status;
    body.append(block("Stav objednávek", grid([
      kpi("Zaplaceno", String(st.paid)),
      kpi("Čeká na platbu", String(st.pending)),
      kpi("Zrušeno", String(st.cancelled)),
      kpi("Vráceno", String(st.refunded)),
    ])));
    body.append(block("Doprava", rankList(d.shipping, "Doprava")));
    body.append(block("Odkud přišly objednávky", rankList(d.sources, "Zdroj"), "Z referreru a UTM. Přímý vstup = bez známého zdroje."));
    var tr = d.traffic;
    var vis = node("div");
    if (tr) {
      vis.append(grid([
        kpi("Návštěvy dnes", String(tr.today), tr.conversion.today == null ? "" : "konverze " + String(tr.conversion.today).replace(".", ",") + " %"),
        kpi("Návštěvy od spuštění", String(tr.total), tr.conversion.total == null ? "" : "konverze " + String(tr.conversion.total).replace(".", ",") + " %"),
      ]));
    } else {
      vis.append(node("p", "hint", "Návštěvnost obchodu zatím není dostupná. Shopify ji dává jen přes přehledy (oprávnění read_reports a podporovaný tarif). Měření webu nadbytecna.cz zůstává ve Vercel Analytics, na obchod veryvera22.cz se nevztahuje."));
    }
    body.append(block("Návštěvnost a konverze", vis, "Konverze = objednávky ÷ návštěvy."));
    body.append(node("p", "hint", "Žádné osobní údaje zákazníků se neukládají ani nezobrazují. Stránka se obnovuje každou minutu."));
  }
  function stopShopTimer() {
    if (shopTimer) clearInterval(shopTimer);
    shopTimer = 0;
  }
  async function loadShop(quiet) {
    var serial = S.serial;
    if (!quiet) {
      $("shop-msg").textContent = "Načítám statistiky e-shopu…";
      clear($("shop-body"));
    }
    try {
      var d = await api({ action: "stats" }, false, "/api/admin-shop/");
      if (S.view !== "shop" || serial !== S.serial) return;
      $("shop-msg").textContent = "";
      renderShop(d);
      if (!shopTimer)
        shopTimer = setInterval(function () {
          if (S.view !== "shop") return stopShopTimer();
          if (!document.hidden) loadShop(true).catch(function () {});
        }, 60000);
    } catch (e) {
      if (e && (e.name === "AbortError" || e.message === "cancelled")) return;
      if (S.view !== "shop") return;
      $("shop-msg").textContent = quiet
        ? "Obnovení se nepodařilo, zkusím to znovu za minutu."
        : "Statistiky e-shopu se nepodařilo načíst. Zkuste to znovu.";
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
      tag(mailReviewed(row) ? "Zkontrolováno člověkem" : "Ke kontrole"),
    );
    if (MAIL_SUBTYPES[row.ai_subtype])
      box.append(tag(MAIL_SUBTYPES[row.ai_subtype]));
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
          : row.ai_at || row.ai_summary || row.ai_help_type
            ? "Návrh AI · vyžaduje kontrolu"
            : "Zatím bez shrnutí AI",
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
    if (MAIL_CONFIDENCES[row.ai_confidence])
      box.append(tag("Návrh AI: " + MAIL_CONFIDENCES[row.ai_confidence] + " jistota"));
    if (row.ai_review_required === true)
      box.append(node("p", "mail-ai-review", "AI upozorňuje na potřebu lidského posouzení."));
    if (row.ai_review_reason)
      box.append(node("p", "hint mail-review-reason", row.ai_review_reason));
    if (row.ai_model)
      box.append(node("p", "hint", row.ai_model + " · " + when(row.ai_at)));
    if (row.ai_error) box.append(node("p", "", "AI se nepodařilo spustit."));
    return box;
  }
  function renderMailStatus(status) {
    M.status = status;
    if ($("mail-source-check")) $("mail-source-check").disabled = !(status.syncEnabled && status.configured && (status.authMode !== "delegated" || status.connected));
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
    if (status.syncEnabled && status.initial_complete === false)
      pieces.push("Historie se ještě načítá; přehled zatím nemusí obsahovat všechny příchozí zprávy.");
    if (status.aiAutomationEnabled)
      pieces.push("Automatická AI analýza je zapnutá; návrhy vyžadují lidskou kontrolu.");
    else if (status.aiEnabled)
      pieces.push("AI lze spustit ručně; automatická analýza je vypnutá.");
    else pieces.push("AI analýza je vypnutá; e-maily můžete zpracovat ručně.");
    if (status.aiQueue) {
      var queue = status.aiQueue;
      if (Number.isInteger(queue.queued) && queue.queued > 0)
        pieces.push("Čeká na automatickou AI: " + queue.queued + ".");
      if (Number.isInteger(queue.awaitingScope) && queue.awaitingScope > 0)
        pieces.push("Bez povolení pro AI: " + queue.awaitingScope + ".");
      if (Number.isInteger(queue.processing) && queue.processing > 0)
        pieces.push("Právě se zpracovává: " + queue.processing + ".");
      if (Number.isInteger(queue.failed) && queue.failed > 0)
        pieces.push("Po neúspěšných pokusech je nutná ruční kontrola: " + queue.failed + ".");
    }
    if (status.originals) {
      var originals = status.originals;
      pieces.push("Uložené originály: " + (originals.archived || 0) + ".");
      if (!status.archiveEnabled) pieces.push("Ukládání originálů je zatím vypnuté.");
      if ((originals.pending || 0) + (originals.processing || 0) > 0) pieces.push("Čeká na uložení originálu: " + ((originals.pending || 0) + (originals.processing || 0)) + ".");
      if (originals.failed > 0) pieces.push("Neuložené originály vyžadující kontrolu: " + originals.failed + ".");
      if (originals.cleanupPending > 0) pieces.push("Dokončuje se odstranění originálů: " + originals.cleanupPending + ".");
    }
    $("mail-sync-status").textContent = pieces.join(" ");
    $("mail-brief").textContent = "veryvera@nadbytecna.cz · " + (status.connected ? "Připojeno" : "Nepřipojeno") + (status.aiEnabled ? " · AI zapnutá" : " · AI vypnutá") + (status.lastError ? " · Načítání vyžaduje kontrolu" : !status.syncEnabled ? " · Načítání vypnuté" : "") + (status.originals?.failed > 0 ? " · Některé originály se neuložily" : "");
    renderMailTriageStats(status.triageStats);
    renderMailConnection(status);
  }
  function renderMailTriageStats(stats) {
    var box = $("mail-triage-stats");
    clear(box);
    if (!stats || !Number.isInteger(stats.unreviewed) || stats.unreviewed < 0) return;
    var pending = button("Ke kontrole: " + stats.unreviewed, function () {
      M.filters.review = "pending";
      M.filters.sort = "newest";
      M.page = 0;
      closeMailDetail();
      renderMailFilters();
      return loadMailList();
    });
    pending.classList.add("mail-review-shortcut");
    box.append(pending);
    if (Number.isInteger(stats.urgent) && stats.urgent >= 0)
      box.append(node("span", "mail-stat", "Akutní a vysoká naléhavost: " + stats.urgent));
    var breakdown = Object.entries(MAIL_SUBTYPES).filter(function (entry) {
      return Number.isInteger(stats.subtypes?.[entry[0]]) && stats.subtypes[entry[0]] > 0;
    }).map(function (entry) { return entry[1] + ": " + stats.subtypes[entry[0]]; });
    if (breakdown.length)
      box.append(node("p", "hint mail-subtype-counts", breakdown.join(" · ")));
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
    clear($("mail-search-slot"));
    var searchWrap = node("div"),
      searchLabel = node("label", "", "Hledat v e-mailech"),
      search = node("input");
    search.id = "mail-search";
    search.type = "search";
    search.maxLength = 200;
    search.value = M.filters.q || "";
    searchLabel.htmlFor = search.id;
    searchWrap.append(searchLabel, search);
    search.placeholder="Hledat v e-mailech…";
    $("mail-search-slot").append(searchWrap);
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
      ["label", "Štítek", global.NadbytecnaMailLabels.catalog(M.status).map(x=>[x.code,x.name])],
      ["disposition", "Pošta", [["normal","Doručené"],["suspect","Podezřelé"],["review","Doporučené ověření"],["all","Všechna pošta"]]],
      ["status", "Stav", Object.entries(MAIL_STATUSES)],
      ["email_type", "Druh e-mailu", Object.entries(MAIL_TYPES)],
      ["subtype", "Podtyp návrhu AI", Object.entries(MAIL_SUBTYPES)],
      ["review", "Lidská kontrola", [["pending", "Ke kontrole"], ["reviewed", "Zkontrolováno"]]],
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
    $("mail-sort").value = M.filters.sort || "urgency";
    clear(cards);
    $("mail-count").textContent = quantity(M.total, "e-mailové vlákno", "e-mailová vlákna", "e-mailových vláken");
    if (!M.rows.length) {
      var empty = node("div", "panel");
      empty.append(node("p", "", M.page > 0
        ? "Na této stránce už nejsou žádná e-mailová vlákna."
        : hasFilters(Object.assign({},M.filters,{disposition:M.filters.disposition === "normal" ? "" : M.filters.disposition}))
          ? "Žádné místní e-mailové vlákno neodpovídá filtrům."
          : "Zatím tu nejsou žádné místní kopie e-mailů. Stav připojení schránky najdete výše."));
      if (M.page > 0)
        empty.append(button("Zpět na první stránku e-mailů", function () {
          M.page = 0;
          loadMailList().catch(mailError);
        }));
      else if (hasFilters(Object.assign({},M.filters,{disposition:M.filters.disposition === "normal" ? "" : M.filters.disposition})))
        empty.append(button("Zrušit filtry e-mailů", function () { $("mail-reset").click(); }));
      cards.append(empty);
    }
    M.rows.forEach(function(row){
      var art=global.NadbytecnaAdminLayout.row({id:row.id,mail:true,name:row.sender_name || row.sender_email || "Neznámý odesílatel",title:row.subject || "Bez předmětu",
        preview:row.preview || row.ai_summary || "Otevřít e-mail",at:mailWhen(row),when:when(mailWhen(row)),status:MAIL_STATUSES[row.status]||row.status,
        acute:mailUrgency(row) === "acute",warning:mailUrgency(row) === "acute" ? "Akutní" : mailReviewed(row) ? "Zkontrolováno" : "Ke kontrole",
        media:row.has_attachments ? "Přílohy" : row.message_count > 1 ? row.message_count+" zpráv" : ""
      },button("Otevřít e-mailové vlákno",function(){return openMailDetail(row.id);},"card-open"));
      if(row.labels?.length || row.disposition === "suspect" || row.disposition === "review")art.append(global.NadbytecnaMailLabels.badges(row,M.status,2));
      cards.append(art);
    });
    global.NadbytecnaAdminLayout.selected(cards,M.detail?.id);
    document.querySelectorAll("[data-mail-queue]").forEach(function(b){var k=b.dataset.mailQueue;var active=k === "suspect" ? M.filters.disposition === "suspect" : M.filters.disposition !== "suspect" && (k === "review" ? M.filters.review === "pending" && !M.filters.status : k === "progress" ? M.filters.status === "in_progress" : k === "archived" ? M.filters.status === "archived" : !M.filters.status && !M.filters.review && (M.filters.disposition || "normal") === "normal");b.setAttribute("aria-pressed",String(active));});
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
    if (!M.detail && innerWidth >= 1024 && S.view === "mail" && M.rows.length) await openMailDetail(M.rows[0].id,0,true);
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
    global.NadbytecnaAdminLayout.selected($("mail-cards"),null);
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
  async function openMailDetail(id, messagePage, automatic) {
    var previousUi=M.detail?.id === id ? global.NadbytecnaAdminLayout.state($("mail-detail")) : null;
    var keyboardSelection=global.NadbytecnaAdminLayout.keyboard();
    var keepListFocus=automatic || keyboardSelection;
    messagePage = Math.max(0, Math.floor(Number(messagePage) || 0));
    var serial = ++M.detailSerial;
    var pendingBox=$("mail-detail");
    clear(pendingBox);
    pendingBox.hidden=true;
    M.detail={id:id};
    var data;
    try { data = await mailApi({
      action: "detail",
      id: id,
      message_page: messagePage,
    }); } catch(e){if(serial===M.detailSerial)closeMailDetail();throw e;}
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
    if (M.status?.labelCatalog) {
      var labelsSection = global.NadbytecnaMailLabels.editor(row,M.status,async function(patch){
        var epoch=S.authEpoch;
        var result;
        try{result=await mailApi(Object.assign({action:"labels",id:row.id,revision:row.revision},patch));}
        catch(error){if(epoch===S.authEpoch && serial===M.detailSerial && S.view==="mail" && error.message==="mail_changed"){await openMailDetail(row.id);mailSay("Mezitím přišla změna vlákna. Zkontrolujte nový obsah a třídění potvrďte znovu.");return;}if(epoch===S.authEpoch && serial===M.detailSerial && S.view==="mail" && error.message==="mail_missing"){closeMailDetail();await loadMailList();mailSay("Vlákno už není dostupné.");return;}throw error;}
        if(epoch!==S.authEpoch || serial!==M.detailSerial || S.view!=="mail")return;
        if(result.saved===false){await openMailDetail(row.id);mailSay("Mezitím přišla změna vlákna. Zkontrolujte nový obsah a třídění potvrďte znovu.");return;}
        if(patch.disposition){closeMailDetail();await loadMailList();}
        else{await openMailDetail(row.id);await loadMailList();}
        mailSay(patch.disposition==="suspect"?"Vlákno je v Podezřelých. Nic nebylo smazáno.":patch.disposition==="normal"?"Vlákno je zpět v běžné poště.":"Štítky a třídění jsou uložené.");
      },mailError);
      box.append(labelsSection);
      var manage=button("Štítky",function(){var group=labelsSection.closest("details");if(group)group.open=true;labelsSection.scrollIntoView({block:"nearest"});labelsSection.querySelector("select,button")?.focus({preventScroll:true});},"mail-labels-manage");
      head.append(manage);
      if(row.labels?.length || row.disposition==="suspect" || row.disposition==="review")box.querySelector(".tag-row").after(global.NadbytecnaMailLabels.badges(row,M.status));
    }
    var checked = mailReviewed(row);
    var reviewBox = section("Lidská kontrola"),
      reviewText = checked
        ? "Aktuální obsah zkontrolován" + (row.reviewed_at ? " · " + when(row.reviewed_at) : "") + (row.reviewed_email ? " · " + row.reviewed_email : "")
        : "Aktuální obsah čeká na kontrolu člověkem.";
    reviewBox.classList.add("mail-human-review");
    reviewBox.append(node("p", "", reviewText));
    var reviewButton = button(checked ? "Vrátit ke kontrole" : "Označit jako zkontrolované", async function () {
      var epoch = S.authEpoch, result;
      reviewButton.disabled = true;
      try {
        try {
          result = await mailApi({ action: "review", id: row.id, revision: row.revision, reviewed: !checked });
        } catch (error) {
          if (error.message !== "mail_changed" && error.message !== "changed") throw error;
          result = { saved: false, reason: "changed" };
        }
        if (epoch !== S.authEpoch || serial !== M.detailSerial || S.view !== "mail") return;
        if (result?.saved !== true && result?.reason !== "changed") throw new Error("mail_review_failed");
        await openMailDetail(row.id, messagePage);
        if (epoch !== S.authEpoch || S.view !== "mail" || M.detail?.id !== row.id) return;
        await loadMailList();
        var status = await mailApi({ action: "status" });
        if (epoch !== S.authEpoch || S.view !== "mail") return;
        renderMailStatus(status);
        mailSay(result.saved === true
          ? (!checked ? "Aktuální obsah vlákna je označený jako zkontrolovaný." : "Vlákno je znovu ke kontrole.")
          : "Mezitím se změnil obsah vlákna. Načetli jsme novou verzi; před označením ji zkontrolujte.");
      } finally {
        if (epoch === S.authEpoch && serial === M.detailSerial) reviewButton.disabled = false;
      }
    });
    reviewButton.disabled = !Number.isInteger(row.revision) || row.revision < 1;
    reviewBox.append(reviewButton);
    box.append(reviewBox);
    if (mailUrgency(row) === "acute")
      box.append(
        node(
          "div",
          "crisis",
          "Akutní případ — vyžaduje bezodkladné lidské posouzení. Platforma není krizová služba.",
        ),
      );
    var aiScopeAllowed = row.ai_scope_blocked !== true &&
      (row.ai_scope_approved === true || M.status?.aiScopeMode === "all");
    var scopeBox = section("Rozsah AI"),
      scopeState = row.ai_scope_blocked === true ? "zablokováno" : row.ai_scope_approved === true ? "povoleno" : "nenastaven",
      scopeLabel = node("label", "check"), scopeInput = node("input");
    scopeInput.type = "checkbox";
    scopeInput.id = "mail-ai-scope-approved";
    scopeInput.checked = row.ai_scope_approved === true && row.ai_scope_blocked !== true;
    scopeLabel.append(scopeInput, document.createTextNode("Projektová konverzace – lze analyzovat AI"));
    scopeBox.classList.add("mail-ai-scope");
    scopeBox.append(
      node("p", "", "Rozsah AI: " + scopeState), scopeLabel,
      node("p", "hint", "Povolení platí pro celé vlákno včetně budoucích odpovědí. Samotné označení AI nezapíná. Uložením bez zaškrtnutí AI pro vlákno zablokujete."),
    );
    if (M.status?.aiScopeMode === "all")
      scopeBox.append(node("p", "hint", "Nastavení projektu dovoluje také neoznačená vlákna; výslovné zablokování má přednost."));
    var saveScope = button("Uložit rozsah AI", async function () {
      var epoch = S.authEpoch;
      saveScope.disabled = true;
      try {
        var result = await mailApi({ action: "ai_scope", id: row.id, revision: row.revision, approved: scopeInput.checked });
        if (epoch !== S.authEpoch || serial !== M.detailSerial || S.view !== "mail") return;
        if (result?.saved !== true && result?.reason !== "changed") throw new Error("mail_scope_failed");
        await openMailDetail(row.id, messagePage);
        if (epoch !== S.authEpoch || S.view !== "mail" || M.detail?.id !== row.id) return;
        await loadMailList();
        var scopeStatus = await mailApi({action:"status"});
        if (epoch !== S.authEpoch || S.view !== "mail" || M.detail?.id !== row.id) return;
        renderMailStatus(scopeStatus);
        mailSay(result.saved === true ? "Rozsah AI pro celé vlákno je uložený. Zapnutí AI se tím nemění."
          : "Mezitím se změnil obsah vlákna. Před určením rozsahu AI zkontrolujte novou verzi.");
      } catch (error) { mailError(error); }
      finally { if (epoch === S.authEpoch && serial === M.detailSerial) saveScope.disabled = false; }
    });
    saveScope.disabled = !Number.isInteger(row.revision) || row.revision < 1;
    scopeBox.append(saveScope);
    box.append(scopeBox);
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
          if (serial === M.detailSerial) run.disabled = !M.status?.aiEnabled || !aiScopeAllowed;
        }
      },
    );
    run.disabled = !M.status?.aiEnabled || !aiScopeAllowed;
    box.append(run);
    if (!aiScopeAllowed)
      box.append(node("p", "hint", "Toto vlákno zatím není povolené pro AI. Nejprve ověřte, že jde o projektovou konverzaci, a uložte rozsah výše."));
    box.append(
      node(
        "p",
        "hint",
        "Návrh AI vychází nejvýše z 30 nejnovějších zpráv a 20 000 znaků. U dlouhého vlákna zkontrolujte také starší zprávy.",
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
    if (currentMessagePage > 0) messages.classList.add("page-older");
    (Array.isArray(data.messages) ? data.messages.slice().sort(function(a,b){return new Date(b.received_at)-new Date(a.received_at)||String(a.id).localeCompare(String(b.id));}) : []).forEach(function (m) {
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
      if (m.has_attachments) article.append(node("p", "hint", "Zpráva obsahuje přílohy."));
      var original = data.originals && Array.isArray(data.originals.messages) ? data.originals.messages.find(function (item) { return item.id === m.id; }) : null;
      if (m.body_truncated || (original && original.bodyTruncated)) article.append(node("p", "mail-notice", "Zobrazený text je zkrácený. Úplné znění uchovává původní e-mail, pokud je jeho originál už uložený."));
      if (original && original.status === "archived") {
        var getOriginal = button("Stáhnout originál .eml", async function () {
          getOriginal.disabled = true;
          try {
            var signed = await mailApi({action: "archive_download", id: m.id});
            var target = new URL(signed.url), expectedOrigin = new URL(cfg().url).origin;
            if (target.origin !== expectedOrigin || !target.pathname.startsWith("/storage/v1/object/sign/mail-originals/") || target.username || target.password || target.hash) throw new Error("archive_url");
            var response = await fetch(target.href, {credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error"});
            if (!response.ok) throw new Error("archive_download");
            var blob = await response.blob();
            if (blob.size > 50 * 1024 * 1024 || blob.size !== signed.size) throw new Error("archive_integrity");
            downloadBlob(blob, "email-" + m.id + ".eml");
          } catch (error) { mailError(error); } finally { getOriginal.disabled = false; }
        });
        article.append(getOriginal);
      } else if (original) {
        article.append(node("p", "hint", original.status === "failed" ? "Originál se nepodařilo uložit; vyžaduje kontrolu." : original.status === "blocked" ? "Originál je zablokovaný kvůli výmazu." : "Originál čeká na uložení."));
        if (original.status === "failed") article.append(button("Zkusit uložit originál znovu", async function () { try { await mailApi({action: "archive_retry", id: m.id}); await openMailDetail(row.id, currentMessagePage); } catch (error) { mailError(error); } }));
      }
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
    global.NadbytecnaAdminLayout.detail(box,"mail",previousUi);
    global.NadbytecnaAdminLayout.selected($("mail-cards"),row.id);
    if (!keepListFocus) box.focus({ preventScroll: true });

  }
  async function load() {
    var data = await api({ action: "init" });
    S.categories = data.categories;
    S.user = data.user;
    S.aiEnabled = data.aiEnabled;
    document.body.classList.add("client-mode");
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
    var pending = global.NadbytecnaAdminPkce && global.NadbytecnaAdminPkce.read();
    // Reuse an unexpired proof: an unsuccessful resend must not break an earlier email.
    var p = await challenge(pending);
    if (!global.NadbytecnaAdminPkce || (!pending && !global.NadbytecnaAdminPkce.save(p.verifier))) {
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
    if (r.ok) {
      say("Pokud máte přístup, přijde vám přihlašovací odkaz. Otevřete poslední odkaz v tomto prohlížeči do 15 minut od první žádosti.");
      return;
    }
    var failure = await r.json().catch(function () { return {}; });
    if (!pending) global.NadbytecnaAdminPkce.clear(p.verifier);
    if (r.status === 429 || failure.code === "over_email_send_rate_limit" || failure.code === "over_request_rate_limit") {
      say("Odesílání přihlašovacích e-mailů je dočasně omezené. Vyčkejte a zkuste to později. Pokud vám už odkaz přišel, můžete ho použít do 15 minut od první žádosti.");
    } else if (failure.code === "email_address_not_authorized" || r.status >= 500) {
      say("Odesílání přihlašovacích e-mailů ještě není připravené. Kontaktujte správce webu.");
    } else {
      say("Odkaz se nepodařilo poslat. Zkuste to později.");
    }
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
    if(!box.hidden){closeFilters();return;}
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
  $("mail-archive-check").addEventListener("click", async function () {
    var btn=$("mail-archive-check");btn.disabled=true;mailSay("Ověřuji uložení a načtení krátkého testovacího originálu…");
    try { var result=await mailApi({action:"archive_integrity_check"});mailSay(result.ok && result.hashVerified && result.deleted ? "Úložiště originálů ověřeno: testovací soubor se uložil, načetl beze změny a byl odstraněn." : "Test úložiště není dokončený. Zkontrolujte stav ukládání originálů."); }
    catch(error) {mailError(error);}finally{btn.disabled=false;}
  });
  $("mail-source-check").addEventListener("click", async function () {
    var btn=$("mail-source-check");btn.disabled=true;mailSay("Porovnávám uložené zprávy s Inboxem Microsoftu…");
    try { var result=await mailApi({action:"source_check"});mailSay((result.matches ? "Počty při kontrole odpovídají. " : "Počty se při kontrole liší; načítání může ještě probíhat. ")+"Inbox Microsoftu: "+result.sourceMessages+" zpráv. Aktivní místní kopie: "+result.activeMessages+". Celkem místně: "+result.allMessages+"."); }
    catch(error) {mailError(error);}finally{btn.disabled=false;}
  });
  $("stories-refresh").addEventListener("click",function(){closeDetail();loadList().catch(error);});
  document.querySelectorAll("[data-mail-queue]").forEach(function(b){b.addEventListener("click",function(){var key=b.dataset.mailQueue;M.filters.disposition=key === "suspect" ? "suspect" : "normal";M.filters.status=key === "progress" ? "in_progress" : key === "archived" ? "archived" : "";M.filters.review=key === "review" ? "pending" : "";M.page=0;closeMailDetail();renderMailFilters();loadMailList().catch(mailError);});});
  $("shop-refresh").addEventListener("click", function () {
    Promise.resolve().then(function () { return loadShop(false); }).catch(error);
  });

  $("mail-refresh").addEventListener("click", function () {
    closeMailDetail();
    loadMail().catch(mailError);
  });
  $("mail-sort").addEventListener("change", function () {
    M.filters.sort = this.value;
    M.page = 0;
    closeMailDetail();
    loadMailList().catch(mailError);
  });
  $("mail-reset").addEventListener("click", function () {
    $("mail-filters").open=false;
    M.filters = {disposition:"normal"};
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
