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
  function choice() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }
  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
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
      gtag("consent", "update", {
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
        analytics_storage: "granted",
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
    var c = ids();
    if (!anyId(c)) return;
    loaded = true;
    if (c.ga4 || c.googleAds) loadGoogle(c);
    if (c.meta) loadMeta(c.meta);
    if (c.tiktok) loadTikTok(c.tiktok);
  }

  function googleConversion(label) {
    var c = ids();
    if (!c.googleAds || !label || !global.gtag) return;
    global.gtag("event", "conversion", { send_to: c.googleAds + "/" + label });
  }

  function track(name, label) {
    if (choice() !== "granted") return;
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
    box.setAttribute("aria-labelledby", "cookie-title");
    var title = document.createElement("p");
    title.id = "cookie-title";
    title.className = "cookie-title";
    title.textContent = "Cookies";
    var text = document.createElement("p");
    text.appendChild(document.createTextNode("Web po souhlasu používá analytické a marketingové cookies (GA4, Google Ads, Meta Pixel, TikTok Pixel), bez souhlasu ne. "));
    var link = document.createElement("a");
    link.href = "/ochrana-osobnich-udaju/";
    link.textContent = "Návrh zásad";
    text.appendChild(link);
    text.appendChild(document.createTextNode("."));
    var row = document.createElement("div");
    row.className = "cookie-row";
    var no = document.createElement("button");
    no.type = "button";
    no.textContent = "Jen nezbytné";
    var yes = document.createElement("button");
    yes.type = "button";
    yes.className = "cookie-yes";
    yes.textContent = "Souhlasím";
    no.addEventListener("click", function () { remember("denied"); hide(box); });
    yes.addEventListener("click", function () { remember("granted"); hide(box); enable(); });
    row.appendChild(no);
    row.appendChild(yes);
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(row);
    document.body.appendChild(box);
  }

  function openSettings() {
    var old = document.querySelector(".cookie");
    if (old) old.hidden = false;
    else banner();
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.id === "cookie-settings") { e.preventDefault(); openSettings(); return; }
    var a = t && t.closest ? t.closest("a[href='https://veryvera.cz'], a[href^='https://veryvera.cz/']") : null;
    if (a && global.NadbytecnaAds) global.NadbytecnaAds.shop();
  });

  if (choice() === "granted") enable();
  else if (!choice()) banner();

  var settings = document.getElementById("cookie-settings");
  if (settings) settings.hidden = false;
})(window);
