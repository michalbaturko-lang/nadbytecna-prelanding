// Úvodní strana jako scroll-cesta. Bez knihoven, bez třetích stran.
//  - mění „scénu“ na pozadí podle kapitoly, na které je střed obrazovky
//  - v kapitole s hesly vybírá aktivní řádek podle posunu (sticky scéna)
//  - jemně odkrývá obsah při příchodu do záběru
// Bez JavaScriptu, bez IntersectionObserveru nebo při „omezit pohyb“ zůstává stránka obyčejně pod sebou.
(function () {
  "use strict";
  var doc = document, root = doc.documentElement, body = doc.body;
  if (!body || body.getAttribute("data-page") !== "scroll") return;
  if (!window.requestAnimationFrame) return;

  var reduced = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var live = !reduced && "IntersectionObserver" in window;
  if (live) root.classList.add("sc-live");

  var chapters = [].slice.call(doc.querySelectorAll("[data-chapter]"));
  var dots = [].slice.call(doc.querySelectorAll(".sc-dots a"));
  var head = doc.querySelector(".site-head");
  var man = doc.getElementById("manifest");
  var lines = man ? [].slice.call(man.querySelectorAll(".sc-line")) : [];
  var count = man ? man.querySelector(".sc-count") : null;
  var shop = doc.getElementById("parfem");
  var scene = -1, idx = -1, ticking = false;

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function update() {
    ticking = false;
    var vh = window.innerHeight || root.clientHeight;

    var s = 0;
    for (var i = 0; i < chapters.length; i++) {
      if (chapters[i].getBoundingClientRect().top <= vh * 0.5) s = Number(chapters[i].getAttribute("data-chapter")) || 0;
    }
    if (s !== scene) {
      scene = s;
      body.setAttribute("data-scene", String(s));
      for (var d = 0; d < dots.length; d++) {
        if (d === s) dots[d].setAttribute("aria-current", "true"); else dots[d].removeAttribute("aria-current");
      }
    }

    if (shop) {
      var sr = shop.getBoundingClientRect();
      body.classList.toggle("sc-shop-in", sr.top < vh * 0.7 && sr.bottom > vh * 0.15);
    }

    if (head) head.classList.toggle("is-scrolled", (window.pageYOffset || root.scrollTop) > 24);

    if (live && man && lines.length) {
      var r = man.getBoundingClientRect();
      var span = r.height - vh;
      var p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      var k = Math.min(lines.length - 1, Math.floor(p * lines.length));
      if (k !== idx) {
        idx = k;
        for (var j = 0; j < lines.length; j++) lines[j].setAttribute("data-d", String(Math.min(3, Math.abs(j - k))));
        if (count) count.textContent = pad(k + 1) + " / " + pad(lines.length);
        follow();
      }
    }
  }

  // aktivní heslo drží uprostřed scény; seznam se posouvá spolu s tím, jak se mění velikosti řádků
  var list = man ? man.querySelector(".claim-list") : null, followUntil = 0, following = false;
  function place() {
    if (!list || idx < 0) return;
    var ln = lines[idx];
    var ty = list.offsetHeight / 2 - (ln.offsetTop + ln.offsetHeight / 2);
    list.style.transform = "translate3d(0," + Math.round(ty) + "px,0)";
  }
  function follow() {
    if (!live || !list) return;
    followUntil = Date.now() + 900;
    if (following) return;
    following = true;
    (function tick() {
      place();
      if (Date.now() < followUntil) window.requestAnimationFrame(tick); else following = false;
    })();
  }

  // tlačítka a odkazy na kapitoly se rozjedou plynulým posunem místo skoku
  var anim = 0;
  function stopAnim() { anim = 0; }
  function glide(y) {
    var from = window.pageYOffset || root.scrollTop, dist = y - from;
    if (Math.abs(dist) < 4) return;
    var dur = Math.min(2800, Math.max(900, 600 + Math.abs(dist) * 0.42));
    var t0 = null, id = ++anim;
    function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function step(ts) {
      if (anim !== id) return;
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / dur);
      window.scrollTo(0, from + dist * ease(t));
      if (t < 1) window.requestAnimationFrame(step); else anim = 0;
    }
    window.requestAnimationFrame(step);
  }
  if (!reduced) {
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (ev) { window.addEventListener(ev, stopAnim, { passive: true }); });
    doc.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var id = a.getAttribute("href").slice(1);
      var el = id ? doc.getElementById(id) : null;
      if (!el) return;
      e.preventDefault();
      var margin = parseFloat(window.getComputedStyle(el).scrollMarginTop) || 0;
      var y = el.getBoundingClientRect().top + (window.pageYOffset || root.scrollTop) - margin;
      glide(Math.max(0, y));
      if (window.history && history.replaceState) history.replaceState(null, "", "#" + id);
    });
  }

  function request() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  }

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", function () { request(); follow(); });
  update();

  if (live) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    [].slice.call(doc.querySelectorAll(".sc-rise")).forEach(function (el) { io.observe(el); });
  }
})();
