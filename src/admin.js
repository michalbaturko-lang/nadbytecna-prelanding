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
  async function api(body, download) {
    var epoch = S.authEpoch;
    var s = await current();
    if (epoch !== S.authEpoch) throw new Error("cancelled");
    if (!s) {
      await logout();
      throw new Error("auth");
    }
    var controller = new AbortController();
    S.pending.add(controller);
    try {
      var r = await fetch("/api/admin/", {
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
      if (!download && ["update", "person_erase"].includes(body.action)) {
        api({ action: "init" })
          .then(function (d) {
            renderCounts(d.counts);
          })
          .catch(error);
      }
      return data;
    } finally {
      S.pending.delete(controller);
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
        "Smažou se všechny zprávy tohoto e-mailu, nahrávky, poznámky a páry. Tuto akci nelze vrátit.",
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
        "Vyhledá příběhy, nabídky i registrace. Před výmazem ověřte oprávněnost žádosti.",
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
        "Export a výmaz se vztahují na všechny záznamy se stejným e-mailem v příbězích, nabídkách a přihlášeních ke spuštění.",
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
    sessionStorage.setItem("nadbytecna-admin-verifier", p.verifier);
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
        ? "Pokud máte přístup, přijde vám přihlašovací odkaz."
        : "Odkaz se nepodařilo poslat. Zkuste to později.",
    );
  }
  async function boot() {
    var p = new URLSearchParams(location.search),
      code = p.get("code");
    if (code) {
      var v = sessionStorage.getItem("nadbytecna-admin-verifier");
      history.replaceState({}, "", "/admin/");
      sessionStorage.removeItem("nadbytecna-admin-verifier");
      if (v) saveSession(asSession(await tokenFromCode(code, v)));
      else
        say("Otevřete odkaz ve stejném prohlížeči, kde jste o něj požádali.");
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
  boot().catch(error);
})(window);
