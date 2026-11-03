// Logo reaguje na přiblížení myši / dotek prstu. Bez knihoven, bez třetích stran.
// VERY VERA nad nápisem se nikdy nehýbe: efekt běží jen na rukopisném „Nadbytečná.cz“.
// Písmena jsou skutečné vektorové tvary (řezy vedené podle spojů mezi písmeny, ne svislé čáry).
//  1. přiblížení: odpadne velké „N“
//  2. přiblížení: odpadnou dvě náhodná písmena a hned potom zbytek kromě „ná“
//  „ná“ se zlatě posune na začátek a pomalu se k němu rozvine „s nic nezlomí!“; pak se vše složí zpátky.
// Bez Canvasu nebo při „omezit pohyb“ zůstává obyčejný obrázek.
(function () {
  "use strict";
  var img = document.querySelector("img.logo[data-split]");
  if (!img) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var DATA = /*LETTERS*/null;
  if (!DATA) return;

  var SPLIT = parseFloat(img.getAttribute("data-split"));        // kde v logu začíná rukopis (podíl výšky)
  var PHRASE = "s nic nezlomí!";
  var PINK = [0xD7, 0x1D, 0x62], GOLD = [0xA9, 0x80, 0x2F];
  var SY = 688;                                                   // posun rukopisu v lockupu (jednotky 2480 široké kresby)
  var CHAIN = true;                                               // po 2. přiblížení hned padá i zbytek
  var ORDER = ["N", "a", "d", "b", "y", "t", "e", "c", "na", "cz"];

  var MX = 0.12, MYB = 1.0;                                       // okraj vlevo/vpravo; prostor pro pád dolů (násobek výšky rukopisu)
  var wrap = document.createElement("span");
  wrap.style.cssText = "position:relative;display:block;line-height:0;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none";
  img.parentNode.insertBefore(wrap, img);
  wrap.appendChild(img);
  var cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:absolute;pointer-events:none;opacity:0";
  wrap.appendChild(cv);
  var ctx = cv.getContext("2d");
  if (!ctx || !window.Path2D) return;
  var tc = document.createElement("canvas"), tx = tc.getContext("2d");   // text fráze (maskuje se při rozvíjení)

  var lw = 0, lh = 0, hs = 0, w = 0, h = 0, dpr = 1, k0 = 1, ready = false;
  var L = {}, tcw = 0;
  ORDER.forEach(function (id) {
    var d = DATA[id];
    L[id] = { id: id, p: new Path2D(d.d), cx: d.cx, cy: d.cy, x0: d.x0, x1: d.x1, mode: "on", t0: 0, vx: 0, rot: 0 };
  });
  var stage = 0, active = false, raf = 0, idleT = 0, chainT = 0, lastPoke = -1e9, seq = null, dirty = true, statics = null;

  function easeIO(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function easeS(x) { return 0.5 - 0.5 * Math.cos(Math.PI * x); }
  function easeOutBack(x) { var c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mix(a, b, t) { return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")"; }

  function layout() {
    var r = img.getBoundingClientRect();
    lw = r.width; lh = r.height;
    if (!lw) return;
    hs = lh * (1 - SPLIT);
    w = lw * (1 + 2 * MX); h = hs * (1 + MYB);
    k0 = lw / 2480;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.width = w + "px"; cv.style.height = h + "px";
    cv.style.left = -lw * MX + "px"; cv.style.top = lh * SPLIT + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    tc.width = cv.width; tc.height = cv.height;
    ready = true;
    dirty = true;
    if (active) draw(performance.now());
  }
  function setScript(c) {                                         // souřadnice kresby (2480 široká) -> pixely plátna
    c.setTransform(dpr * k0, 0, 0, dpr * k0, dpr * MX * lw, dpr * (SY * k0 - SPLIT * lh));
  }
  function show(on) {
    active = on;
    cv.style.opacity = on ? "1" : "0";
    img.style.clipPath = on ? "inset(0 0 " + ((1 - SPLIT) * 100).toFixed(3) + "% 0)" : "";
  }

  // ---- póza jednoho písmene v čase ----
  var FALL = 1000, WOB = 0.2, BACK = 900;
  function pose(l, now, o) {
    o.dx = 0; o.dy = 0; o.r = 0; o.a = 1; o.draw = true;
    if (l.mode === "on") return;
    var t = (now - l.t0) / 1000;
    if (l.mode === "fall") {
      if (t < 0) return;
      var u = Math.max(0, t - WOB);
      o.r = Math.sin(t * 55) * 0.035 * (1 - Math.min(1, t / WOB));
      if (u > 0) {
        o.dy = 800 * u * u; o.dx = l.vx * u; o.r += l.rot * u * u;
        o.a = u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55;
        if (u >= 1) { l.mode = "gone"; o.draw = false; }
      }
    } else if (l.mode === "gone") o.draw = false;
    else if (l.mode === "back") {
      if (t < 0) { o.draw = false; return; }
      var r = Math.min(1, t / (BACK / 1000));
      o.dy = (1 - easeOutBack(r)) * 120; o.a = Math.min(1, r * 2);
      if (r >= 1) { l.mode = "on"; dirty = true; o.dy = 0; o.a = 1; }
    }
  }

  var po = { dx: 0, dy: 0, r: 0, a: 1, draw: true };
  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    setScript(ctx);
    if (dirty) {
      statics = new Path2D();
      ORDER.forEach(function (id) { if (L[id].mode === "on" && !(seq && id === "na")) statics.addPath(L[id].p); });
      dirty = false;
    }
    ctx.fillStyle = mix(PINK, PINK, 0);
    ctx.fill(statics);
    var id, l;
    for (var i = 0; i < ORDER.length; i++) {
      id = ORDER[i]; l = L[id];
      if (id === "na" && seq) { drawNa(now); continue; }
      if (l.mode === "on") continue;
      pose(l, now, po);
      if (!po.draw) continue;
      ctx.save();
      ctx.globalAlpha = po.a;
      ctx.translate(l.cx + po.dx, l.cy + po.dy); ctx.rotate(po.r); ctx.translate(-l.cx, -l.cy);
      ctx.fill(l.p);
      ctx.restore();
    }
    if (seq) drawPhrase(now);
  }

  // ---- finále: „ná“ + zlatá fráze ----
  function drawNa(now) {
    var t = now - seq.t0, s = easeIO(clamp01((t - seq.Tslide) / 1300)), b = easeIO(clamp01((t - seq.Tback) / 1100));
    seq.k = s * (1 - b);
    var l = L.na;
    ctx.save();
    ctx.translate(seq.dx * seq.k, 0);
    ctx.fillStyle = mix(PINK, GOLD, seq.k);
    ctx.fill(l.p);
    ctx.restore();
  }
  function drawPhrase(now) {
    var t = now - seq.t0, p = clamp01((t - seq.Tunroll) / seq.Dunroll), ex = clamp01((t - seq.Tfade) / 700);
    if (p <= 0 || ex >= 1) return;
    var e = easeS(p), soft = 150;
    var x0 = seq.tx, x1 = seq.tx + seq.tw;
    var front = x0 - soft + e * (x1 - x0 + soft + 30);
    tx.setTransform(1, 0, 0, 1, 0, 0); tx.clearRect(0, 0, tc.width, tc.height);
    setScript(tx);
    tx.font = seq.fsz + "px Damion, cursive"; tx.textBaseline = "alphabetic"; tx.fillStyle = mix(GOLD, GOLD, 0);
    tx.fillText(PHRASE, seq.tx, seq.base + (1 - e) * 26);        // text se při rozvíjení lehce zvedá
    tx.globalCompositeOperation = "destination-in";
    var g = tx.createLinearGradient(front - soft, 0, front, 0);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    tx.fillStyle = g; tx.fillRect(-100, -300, 2480 + 200, 1500);
    tx.globalCompositeOperation = "source-over";
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1 - ex; ctx.drawImage(tc, 0, 0); ctx.restore();
  }

  function loop() {
    raf = 0;
    var now = performance.now();
    var busy = false, i, l;
    for (i = 0; i < ORDER.length; i++) {
      l = L[ORDER[i]];
      if (l.mode === "back" || (l.mode === "fall" && now - l.t0 < (WOB + 1.05) * 1000)) busy = true;
    }
    if (seq) {
      busy = true;
      if (now - seq.t0 >= seq.end) finish();
    }
    draw(now);
    if (!seq && !busy) {
      var allOn = ORDER.every(function (id) { return L[id].mode === "on"; });
      if (allOn && stage === 0) { show(false); return; }
    }
    if (busy || seq) raf = requestAnimationFrame(loop);
  }
  function wake() { if (ready && !raf) raf = requestAnimationFrame(loop); }

  function fallOne(id, delay, now) {
    var l = L[id];
    l.mode = "fall"; l.t0 = now + delay;
    l.vx = (Math.random() - 0.5) * 160; l.rot = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.9);
    dirty = true;
  }
  function restoreAll(now) {
    var n = 0;
    ORDER.slice().sort(function () { return Math.random() - 0.5; }).forEach(function (id) {
      var l = L[id];
      if (l.mode === "fall" || l.mode === "gone") { l.mode = "back"; l.t0 = now + 60 * n++; dirty = true; }
    });
    stage = 0;
    wake();
  }

  function finalSeq(px, now) {
    var ids = ORDER.filter(function (id) { return id !== "na" && L[id].mode === "on"; }), dmax = 0;
    ids.forEach(function (id) {
      var d = Math.abs(L[id].cx - px) / 2480 * 900 + Math.random() * 50;
      dmax = Math.max(dmax, d); fallOne(id, d, now);
    });
    var n = L.na, fsz = 430, tw, gap = -8;
    tx.font = fsz + "px Damion, cursive"; tw = tx.measureText(PHRASE).width;
    var nw = n.x1 - n.x0;
    while (nw + gap + tw > 2480 * 0.96 && fsz > 40) { fsz -= 4; tx.font = fsz + "px Damion, cursive"; tw = tx.measureText(PHRASE).width; }
    var total = nw + gap + tw, left = (2480 - total) / 2;
    var Tslide = dmax + (WOB + 1.0) * 1000 + 250, Tunroll = Tslide + 900, Dunroll = 3400, Tfade = Tunroll + Dunroll + 3200, Tback = Tfade + 100;
    seq = { t0: now, dx: left - n.x0, tx: left + nw + gap, tw: tw, fsz: fsz, base: 336, Tslide: Tslide, Tunroll: Tunroll, Dunroll: Dunroll, Tfade: Tfade, Tback: Tback, k: 0,
      end: Tback + 1100 + 300 };
    dirty = true;
    stage = 3;
  }
  function finish() {
    var now = performance.now();
    seq = null; dirty = true;
    L.na.mode = "on";
    ORDER.forEach(function (id) { var l = L[id]; if (l.mode === "fall" || l.mode === "gone") { l.mode = "back"; l.t0 = now + 70 * Math.random() * 6; } });
    stage = 0;
  }

  function poke(px, now) {                                         // px v jednotkách kresby
    if (!ready || seq) return;
    if (now - lastPoke < 650) return;
    lastPoke = now;
    clearTimeout(idleT); clearTimeout(chainT);
    if (!active) show(true);
    stage++;
    if (stage === 1) {
      fallOne("N", 0, now);
      idleT = setTimeout(function () { restoreAll(performance.now()); }, 9000);
    } else if (stage === 2) {
      var cand = ["a", "d", "b", "y", "t", "e", "c"].filter(function (id) { return L[id].mode === "on"; }), n = 0;
      while (n < 2 && cand.length) { fallOne(cand.splice(Math.floor(Math.random() * cand.length), 1)[0], n * 160, now); n++; }
      if (CHAIN) chainT = setTimeout(function () { finalSeq(px, performance.now()); wake(); }, 1500);
      else idleT = setTimeout(function () { restoreAll(performance.now()); }, 9000);
    } else finalSeq(px, now);
    wake();
  }

  // ---- přiblížení / dotek ----
  var inside = false;
  function hit(e) {                                               // jen rukopisná část, ne VERY VERA
    var r = img.getBoundingClientRect(), top = r.top + r.height * SPLIT, padx = r.width * 0.04;
    return e.clientX > r.left - padx && e.clientX < r.right + padx && e.clientY > top - r.height * 0.02 && e.clientY < r.bottom + r.height * 0.06;
  }
  function onPoint(e) {
    var ins = hit(e);
    if (e.pointerType !== "touch") wrap.style.cursor = ins ? "pointer" : "";
    if (ins && !inside && ready) {
      var r = img.getBoundingClientRect();
      poke((e.clientX - r.left) / r.width * 2480, performance.now());
    }
    inside = ins;
  }
  window.addEventListener("pointermove", onPoint, { passive: true });
  window.addEventListener("pointerdown", function (e) { if (e.pointerType === "touch") inside = false; onPoint(e); }, { passive: true });
  function leave(e) { if (!e || e.pointerType === "touch" || e.type === "pointercancel") inside = false; }
  window.addEventListener("pointerup", function (e) { if (e.pointerType === "touch") inside = false; }, { passive: true });
  window.addEventListener("pointercancel", function () { inside = false; }, { passive: true });
  document.addEventListener("pointerleave", function () { inside = false; });

  var rt = 0;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (!seq) layout(); }, 150); });
  function start() {
    var p = document.fonts && document.fonts.load ? document.fonts.load("40px Damion", PHRASE) : Promise.resolve();
    p.then(layout, layout);
  }
  if (img.complete && img.naturalWidth) start(); else img.addEventListener("load", start);
})();
