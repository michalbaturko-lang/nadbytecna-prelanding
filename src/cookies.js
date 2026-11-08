// Reklamní a analytické značky až po souhlasu. Bez ID v configu se nenačítají.
(function (global) {
  "use strict";
  var KEY = "nadbytecna-consent";
  var loaded = false;

  function ads() { return global.NADBYTECNA_ADS || {}; }
  function ok(re, value) { return re.test(String(value || "")); }
  function ids() {
    var c = ads();
    return {
      meta: ok(/^\d{5,20}$/, c.meta) ? c.meta : "",
      ga4: ok(/^G-[A-Z0-9]+$/, c.ga4) ? c.ga4 : "",
      googleAds: ok(/^AW-\d+$/, c.ads) ? c.ads : "",
      adsStory: ok(/^[A-Za-z0-9_-]{1,40}$/, c.adsStory) ? c.adsStory : "",
      adsHelp: ok(/^[A-Za-z0-9_-]{1,40}$/, c.adsHelp) ? c.adsHelp : "",
      adsShop: ok(/^[A-Za-z0-9_-]{1,40}$/, c.adsShop) ? c.adsShop : "",
      tiktok: ok(/^[A-Z0-9]{5,40}$/, c.tiktok) ? c.tiktok : "",
    };
  }
  function anyId(c) { return Boolean(c.meta || c.ga4 || c.googleAds || c.tiktok); }
  function readChoice() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }
  function prefs() {
    var raw = readChoice();
    if (raw === "granted") return { analytics: true, marketing: true };
    if (raw === "denied") return { analytics: false, marketing: false };
    if (raw && raw.charAt(0) === "{") {
      try {
        var data = JSON.parse(raw);
        return { analytics: Boolean(data.analytics), marketing: Boolean(data.marketing) };
      } catch (e) {}
    }
    return null;
  }
  function remember(value) {
    try { localStorage.setItem(KEY, typeof value === "string" ? value : JSON.stringify(value)); } catch (e) {}
  }

  function script(src) {
    return new Promise(function (resolve) {
      var el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = function () { resolve(true); };
      el.onerror = function () { resolve(false); };
      document.head.appendChild(el);
    });
  }

  function gtag() { global.dataLayer.push(arguments); }

  function loadGoogle(c) {
    global.dataLayer = global.dataLayer || [];
    global.gtag = global.gtag || gtag;
    gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
      functionality_storage: "denied",
      personalization_storage: "denied",
      security_storage: "granted",
      wait_for_update: 500,
    });
    var id = c.ga4 || c.googleAds;
    return script("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id)).then(function () {
    var want = prefs() || { analytics: false, marketing: false };
    gtag("consent", "update", {
      ad_storage: want.marketing ? "granted" : "denied",
      ad_user_data: want.marketing ? "granted" : "denied",
      ad_personalization: want.marketing ? "granted" : "denied",
      analytics_storage: want.analytics ? "granted" : "denied",
    });
      gtag("js", new Date());
      if (c.ga4) gtag("config", c.ga4, { anonymize_ip: true });
      if (c.googleAds) gtag("config", c.googleAds);
    });
  }

  function loadMeta(id) {
    if (global.fbq) return Promise.resolve();
    var fbq = function () { fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments); };
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    global.fbq = fbq;
    global._fbq = fbq;
    return script("https://connect.facebook.net/en_US/fbevents.js").then(function () {
      global.fbq("consent", "revoke");
      global.fbq("init", id);
      global.fbq("consent", "grant");
      global.fbq("track", "PageView");
    });
  }

  function loadTikTok(id) {
    if (global.ttq) return Promise.resolve();
    var ttq = global.ttq = global.ttq || [];
    ttq.methods = ["page", "track", "identify", "instances", "debug", "on", "off", "once", "ready", "alias", "group", "enableCookie", "disableCookie", "holdConsent", "revokeConsent", "grantConsent"];
    ttq.setAndDefer = function (obj, method) {
      obj[method] = function () { obj.push([method].concat(Array.prototype.slice.call(arguments, 0))); };
    };
    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.load = function (pixel) {
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=" + encodeURIComponent(pixel) + "&lib=ttq";
      document.head.appendChild(s);
    };
    ttq.load(id);
    if (ttq.holdConsent) ttq.holdConsent();
    if (ttq.grantConsent) ttq.grantConsent();
    if (ttq.page) ttq.page();
    return Promise.resolve();
  }

  function enable() {
    if (loaded) return;
    var want = prefs();
    if (!want || (!want.analytics && !want.marketing)) return;
    var c = ids();
    if (!anyId(c)) return;
    loaded = true;
    if (want.analytics && c.ga4 || want.marketing && c.googleAds) loadGoogle(c);
    if (want.marketing && c.meta) loadMeta(c.meta);
    if (want.marketing && c.tiktok) loadTikTok(c.tiktok);
  }

  function googleConversion(label) {
    var c = ids();
    if (!c.googleAds || !label || !global.gtag) return;
    global.gtag("event", "conversion", { send_to: c.googleAds + "/" + label });
  }

  function track(name, label) {
    var want = prefs();
    if (!want || (!want.analytics && !want.marketing)) return;
    var c = ids();
    if (global.gtag) global.gtag("event", name);
    googleConversion(label);
    if (global.fbq) global.fbq("trackCustom", name);
    if (global.ttq && global.ttq.track) global.ttq.track(name === "shop_click" ? "ClickButton" : "SubmitForm", { content_name: name });
  }

  global.NadbytecnaAds = {
    story: function () { track("story_submit", ids().adsStory); },
    help: function () { track("help_submit", ids().adsHelp); },
    shop: function () { track("shop_click", ids().adsShop); },
  };

  function hide(box) { if (box) box.hidden = true; }

  function banner() {
    var box = document.createElement("div");
    box.className = "cookie";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Cookies");
    var text = document.createElement("p");
    text.textContent = "Používáme cookies.";
    var row = document.createElement("div");
    row.className = "cookie-row";
    var yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "Přijmout";
    var no = document.createElement("button");
    no.type = "button";
    no.textContent = "Odmítnout";
    var set = document.createElement("a");
    set.href = "/cookies/";
    set.className = "cookie-more";
    set.textContent = "Nastavení";
    function close(value) { remember(value); hide(box); enable(); }
    no.addEventListener("click", function () { close("denied"); });
    yes.addEventListener("click", function () { close("granted"); });
    row.appendChild(yes);
    row.appendChild(no);
    row.appendChild(set);
    box.appendChild(text);
    box.appendChild(row);
    document.body.appendChild(box);
  }

  function bindPage() {
    var detail = document.getElementById("cookie-detail");
    if (!detail) return;
    var analytics = document.getElementById("cookie-analytics");
    var marketing = document.getElementById("cookie-marketing");
    var current = prefs();
    if (current) {
      if (analytics) analytics.checked = current.analytics;
      if (marketing) marketing.checked = current.marketing;
    }
    var save = document.getElementById("cookie-save");
    if (!save) return;
    save.addEventListener("click", function () {
      remember({ analytics: Boolean(analytics && analytics.checked), marketing: Boolean(marketing && marketing.checked) });
      enable();
      var box = document.querySelector(".cookie");
      hide(box);
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.id === "cookie-settings") {
      if (!document.getElementById("cookie-detail")) window.location.href = "/cookies/";
      return;
    }
    var a = t && t.closest ? t.closest("a[href='https://veryvera22.cz'], a[href^='https://veryvera22.cz/']") : null;
    if (a && global.NadbytecnaAds) global.NadbytecnaAds.shop();
  });

  if (prefs()) enable();
  else banner();
  bindPage();

  var settings = document.getElementById("cookie-settings");
  if (settings) settings.hidden = false;
})(window);
