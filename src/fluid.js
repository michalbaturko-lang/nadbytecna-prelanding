// Logo reaguje na dotek. Bez knihoven, bez třetích stran; WebGL mřížka nad obrázkem.
// VERY VERA nad nápisem se nikdy nehýbe: efekt běží jen na rukopisné části „Nadbytečná.cz“.
//  výchozí, postupně po každém klepnutí/kliknutí na rukopis:
//                    1. odpadne velké „N“, 2. odpadnou dvě náhodná písmena, 3. odpadne zbytek, „ná“ se zlatě
//                    posune doleva a zespoda k němu naskáče „s nic nezlomí!“; pak se vše složí zpátky.
//  ?efekt=uhyb      písmena uskakují před prstem a vracejí se.
// Bez WebGL nebo při „omezit pohyb“ zůstává obyčejný obrázek.
(function () {
  "use strict";
  var img = document.querySelector("img.logo[data-split]");
  if (!img) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var MODE = /[?&]efekt=uhyb/.test(location.search) ? "dodge" : "seq";

  var SPLIT = parseFloat(img.getAttribute("data-split"));        // kde v logu začíná rukopis (podíl výšky)
  var BASE = parseFloat(img.getAttribute("data-base"));          // účaří rukopisu (podíl výšky)
  var NA0 = parseFloat(img.getAttribute("data-na0"));            // „ná“ zleva / zprava (podíl šířky)
  var NA1 = parseFloat(img.getAttribute("data-na1"));
  var HAT = parseFloat(img.getAttribute("data-hat"));            // pravý konec háčku nad „č“ (podíl šířky)
  var HATY = parseFloat(img.getAttribute("data-haty"));          // spodek háčku (podíl výšky)
  var PHRASE = "s nic nezlomí!";
  var GOLD = [0.663, 0.502, 0.184];                              // #A9802F

  var MX = 0.12, MYB = 1.0;                                       // okraj vlevo/vpravo; prostor pro pád dolů (násobek výšky rukopisu)
  var GX = 192, GY = 26;
  var wrap = document.createElement("span");
  wrap.style.cssText = "position:relative;display:block;line-height:0;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none";
  img.parentNode.insertBefore(wrap, img);
  wrap.appendChild(img);
  var cv = document.createElement("canvas"), gv = document.createElement("canvas");
  [cv, gv].forEach(function (c) { c.setAttribute("aria-hidden", "true"); c.style.cssText = "position:absolute;pointer-events:none;opacity:0"; wrap.appendChild(c); });
  var gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
  var g2 = gv.getContext("2d");
  if (!gl || !g2) return;

  var vs = "attribute vec2 p;attribute vec2 t;attribute float a;varying vec2 v;varying float q;uniform vec2 s;" +
    "void main(){v=t;q=a;gl_Position=vec4(p.x/s.x*2.0-1.0,1.0-p.y/s.y*2.0,0.0,1.0);}";
  var fs = "precision mediump float;varying vec2 v;varying float q;uniform sampler2D u;uniform float k;uniform vec3 gold;" +
    "void main(){vec4 c=texture2D(u,v);vec3 rgb=mix(c.rgb,gold*c.a,k);gl_FragColor=vec4(rgb,c.a)*q;}";
  function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; }
  var pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);

  var NX = GX + 1, NY = GY + 1, N = NX * NY;
  var i, j;
  var tc = new Float32Array(N * 2);
  for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) { tc[(j * NX + i) * 2] = i / GX; tc[(j * NX + i) * 2 + 1] = j / GY; }
  var pb = gl.createBuffer(), tb = gl.createBuffer(), ab = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tb); gl.bufferData(gl.ARRAY_BUFFER, tc, gl.STATIC_DRAW);
  var lt = gl.getAttribLocation(pr, "t"), lp = gl.getAttribLocation(pr, "p"), la = gl.getAttribLocation(pr, "a");
  var us = gl.getUniformLocation(pr, "s"), uk = gl.getUniformLocation(pr, "k"), ug = gl.getUniformLocation(pr, "gold");
  gl.uniform3f(ug, GOLD[0], GOLD[1], GOLD[2]);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  var ib = { all: gl.createBuffer(), dyn: gl.createBuffer(), surv: gl.createBuffer() }, cnt = {};
  var tex1 = null, tex2 = null;
  var ready = false, w = 0, h = 0, lw = 0, lh = 0, hs = 0, dpr = 1, k0 = 1;
  var ox, oy, vx, vy, bx, by, pos, al, i0, i1;
  var ptr = { x: -1e4, y: -1e4, down: false, on: false };
  var raf = 0, seq = null;
  var NG = 10, NAG = 8, CZG = 9;                                  // skupiny: 0..7 N a d b y t e č, 8 = „ná“, 9 = „.cz“
  var CUT = [400, 590, 815, 1000, 1175, 1340, 1450];              // pravé hrany N a d b y t e (jednotky 2480 široké kresby)
  var vg, gcx = [], gcy = [], gst = [], grs = [], grot = [], gdl = [], gy = [], ga = [], gr = [];
  var stage = 0, idleT = 0, restoring = false, nax = 0, dynOn = false;
  function resetGroups() { for (var L = 0; L < NG; L++) { gst[L] = -1; grs[L] = -1; grot[L] = 0; gdl[L] = 0; gy[L] = 0; ga[L] = 1; gr[L] = 0; } stage = 0; restoring = false; nax = 0; clearTimeout(idleT); }
  resetGroups();

  function easeOutBack(x) { var c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function easeIO(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  function mkTex(canvas2d, t) {
    if (!t) t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas2d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function layout() {
    var r = img.getBoundingClientRect();
    lw = r.width; lh = r.height;
    if (!lw) return;
    hs = lh * (1 - SPLIT);
    w = lw * (1 + 2 * MX); h = hs * (1 + MYB);
    k0 = lw / 2480;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    [cv, gv].forEach(function (c) {
      c.style.width = w + "px"; c.style.height = h + "px";
      c.style.left = -lw * MX + "px"; c.style.top = lh * SPLIT + "px";
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    });
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(us, w, h);
    bx = new Float32Array(N); by = new Float32Array(N);
    for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) { bx[j * NX + i] = i / GX * w; by[j * NX + i] = j / GY * h; }
    ox = new Float32Array(N); oy = new Float32Array(N); vx = new Float32Array(N); vy = new Float32Array(N);
    al = new Float32Array(N).fill(1);
    pos = new Float32Array(N * 2);
    // „ná“ = sloupce mřížky i0..i1 (zarovnáno na hranu buňky)
    i0 = Math.round((MX + NA0) * lw / w * GX); i1 = Math.round((MX + NA1) * lw / w * GX);
    var all = [], surv = [], cutc = CUT.map(function (u) { return (MX * lw + u * k0) / w * GX; });
    vg = new Int8Array(N);
    var sx = new Float32Array(NG), sy2 = new Float32Array(NG), sn = new Float32Array(NG);
    for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) {
      var L, xu = (i / GX * w - MX * lw) / k0;
      if (i >= i0 && i <= i1) L = NAG;
      else if (i > i1) L = CZG;
      else { L = 0; while (L < CUT.length && i >= cutc[L]) L++; }
      if (L === 1 && xu < 495 && j < 5) L = 0;                     // špička velkého „N“ nad „a“
      if (L === 3 && xu < 885 && j < 4) L = 2;                      // špička dříku „d“ nad „b“
      if (L === 3 && xu >= 840 && j >= 9) L = 4;                   // smyčka „y“ pod „b“
      vg[j * NX + i] = L; sx[L] += bx[j * NX + i]; sy2[L] += by[j * NX + i]; sn[L]++;
    }
    for (var L2 = 0; L2 < NG; L2++) { gcx[L2] = sn[L2] ? sx[L2] / sn[L2] : 0; gcy[L2] = sn[L2] ? sy2[L2] / sn[L2] : 0; }
    for (j = 0; j < GY; j++) for (i = 0; i < GX; i++) {
      var a0 = j * NX + i;
      Array.prototype.push.apply(all, [a0, a0 + 1, a0 + NX, a0 + 1, a0 + NX + 1, a0 + NX]);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib.all); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(all), gl.STATIC_DRAW); cnt.all = all.length;
    resetGroups();
    // textura 1: rukopisná část loga; textura 2: jen „ná“ (bez háčku z „č“)
    var FW = Math.round(lw * dpr), FH = Math.round(lh * dpr);
    var full = document.createElement("canvas"); full.width = FW; full.height = FH;
    full.getContext("2d").drawImage(img, 0, 0, FW, FH);
    var c2 = document.createElement("canvas"); c2.width = cv.width; c2.height = cv.height;
    var x2 = c2.getContext("2d");
    var sy = Math.round(SPLIT * FH);
    x2.drawImage(full, 0, sy, FW, FH - sy, lw * MX * dpr, 0, FW, FH - sy);
    tex1 = mkTex(c2, tex1);
    var c3 = document.createElement("canvas"); c3.width = c2.width; c3.height = c2.height;
    var x3 = c3.getContext("2d");
    var sx0 = i0 / GX * w * dpr, sx1 = i1 / GX * w * dpr;
    x3.drawImage(c2, sx0, 0, sx1 - sx0, c2.height, sx0, 0, sx1 - sx0, c2.height);
    x3.clearRect(sx0, 0, (MX + HAT) * lw * dpr - sx0, (HATY - SPLIT) * lh * dpr);
    var gr = x3.createLinearGradient(sx0, 0, sx0 + 22 * k0 * dpr, 0);       // měkký náběh vlevo: řez přes tah „č–n“ není vidět
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)");
    x3.globalCompositeOperation = "destination-in"; x3.fillStyle = gr; x3.fillRect(sx0, 0, sx1 - sx0, c3.height);
    x3.globalCompositeOperation = "source-over";
    tex2 = mkTex(c3, tex2);
    ready = true;
    draw();
    cv.style.opacity = "1"; img.style.clipPath = "inset(0 0 " + ((1 - SPLIT) * 100).toFixed(3) + "% 0)";
  }

  function drawPass(buf, tex, kk) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib[buf]);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1f(uk, kk);
    gl.drawElements(gl.TRIANGLES, cnt[buf], gl.UNSIGNED_SHORT, 0);
  }
  var tint = 0;
  function draw() {
    for (var q = 0; q < N; q++) { pos[q * 2] = bx[q] + ox[q]; pos[q * 2 + 1] = by[q] + oy[q]; }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, tb);
    gl.enableVertexAttribArray(lt); gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ab); gl.bufferData(gl.ARRAY_BUFFER, al, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 1, gl.FLOAT, false, 0, 0);
    if (stage > 0) { drawPass("dyn", tex1, 0); if (stage === 3) drawPass("surv", tex2, tint); }
    else drawPass("all", tex1, 0);
  }

  // ---- postupné odpadávání písmen ----
  var F = 1000, B = 900, GSTEP = 75, GJUMP = 560;
  function active(L) { return gst[L] >= 0 || grs[L] >= 0; }
  function buildDyn() {                                           // buňky mezi padajícím a stojícím písmenem se nekreslí (jinak by se natáhly)
    var d = [], i, j, g, q, a0, v;
    for (j = 0; j < GY; j++) for (i = 0; i < GX; i++) {
      a0 = j * NX + i; v = [a0, a0 + 1, a0 + NX, a0 + NX + 1];
      g = [vg[v[0]], vg[v[1]], vg[v[2]], vg[v[3]]];
      var same = g[0] === g[1] && g[1] === g[2] && g[2] === g[3];
      if (same && stage === 3 && g[0] === NAG) continue;          // „ná“ kreslí zvlášť
      if (!same && (active(g[0]) || active(g[1]) || active(g[2]) || active(g[3]))) continue;
      d.push(a0, a0 + 1, a0 + NX, a0 + 1, a0 + NX + 1, a0 + NX);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib.dyn); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(d), gl.STATIC_DRAW); cnt.dyn = d.length;
    var sv = [];
    for (j = 0; j < GY; j++) for (i = i0; i < i1; i++) { a0 = j * NX + i; sv.push(a0, a0 + 1, a0 + NX, a0 + 1, a0 + NX + 1, a0 + NX); }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib.surv); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sv), gl.STATIC_DRAW); cnt.surv = sv.length;
  }
  function stepGroups(t) {
    var more = false, L, k, any = false;
    for (L = 0; L < NG; L++) {
      if (L === NAG) continue;
      var y = 0, a = 1, rot = 0;
      if (grs[L] >= 0 && t >= grs[L]) {
        var r = Math.min(1, (t - grs[L]) / B);
        y = (1 - easeOutBack(r)) * hs * 0.45; a = Math.min(1, r * 1.6);
        if (r >= 1) { gst[L] = -1; grs[L] = -1; y = 0; a = 1; } else more = true;
      } else if (gst[L] >= 0 && t >= gst[L]) {
        var u = Math.min(1, (t - gst[L]) / F);
        y = hs * 0.9 * u * u; a = Math.max(0, 1 - u * 1.15); rot = grot[L] * u * u;
        if (u < 1 || grs[L] >= 0) more = true;
      } else if (gst[L] >= 0 || grs[L] >= 0) more = true;
      if (gst[L] >= 0) any = true;
      gy[L] = y; ga[L] = a; gr[L] = rot;
    }
    for (k = 0; k < N; k++) {
      L = vg[k];
      if (L === NAG) { ox[k] = nax; oy[k] = 0; al[k] = 1; continue; }
      var cs = Math.cos(gr[L]), sn = Math.sin(gr[L]), dx = bx[k] - gcx[L], dy = by[k] - gcy[L];
      ox[k] = (cs - 1) * dx - sn * dy; oy[k] = sn * dx + (cs - 1) * dy + gy[L]; al[k] = ga[L];
    }
    if (!any && !seq && stage > 0) { stage = 0; restoring = false; }   // vše je zpátky
    return more;
  }
  function restoreAll() {
    if (seq || !stage) return;
    restoring = true;
    var now = performance.now(), n = 0;
    for (var L = 0; L < NG; L++) if (gst[L] >= 0) grs[L] = now + (n++) * 70 + Math.random() * 40;
    wake();
  }
  function poke(px) {
    if (!ready || restoring || seq || stage >= 3) return;
    clearTimeout(idleT);
    stage++;
    var now = performance.now(), drop = [], L, spread = Math.max(lw, 200), cand = [];
    if (stage === 1) drop = [0];
    else if (stage === 2) {
      for (L = 1; L <= 7; L++) if (gst[L] < 0) cand.push(L);
      while (drop.length < 2 && cand.length) drop.push(cand.splice(Math.floor(Math.random() * cand.length), 1)[0]);
    } else for (L = 0; L < NG; L++) if (L !== NAG && gst[L] < 0) drop.push(L);
    var dmax = 0;
    drop.forEach(function (g, n) {
      var d = stage === 3 ? Math.abs(gcx[g] - px) / spread * 1000 + Math.random() * 20 : n * 140;
      gst[g] = now + d; gdl[g] = d; dmax = Math.max(dmax, d);
      grot[g] = (Math.random() < 0.5 ? -1 : 1) * (0.12 + Math.random() * 0.22);
    });
    buildDyn();
    if (stage === 3) startSeq(px, dmax);
    else idleT = setTimeout(restoreAll, 9000);
    wake();
  }
  function startSeq(px, dmax) {
    var fam = "Damion";
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    var fsz = Math.round(430 * k0), wn = (i1 - i0) / GX * w, gap = -2 * k0, tw;
    function meas() { g2.font = fsz + "px " + fam + ", cursive"; tw = g2.measureText(PHRASE).width; }
    meas();
    while (wn + gap + tw > lw * 0.97 && fsz > 12) { fsz -= 2; meas(); }
    var total = wn + gap + tw, left = MX * lw + (lw - total) / 2;
    var glyphs = [], c;
    for (c = 0; c < PHRASE.length; c++) if (PHRASE[c] !== " ") glyphs.push({ ch: PHRASE[c], x: left + wn + gap + g2.measureText(PHRASE.slice(0, c)).width });
    var now = performance.now();
    var T1 = dmax + F + 150, Tg0 = T1 + 450, last = Tg0 + GSTEP * (glyphs.length - 1) + GJUMP, Texit = last + 2300, end = Texit + 1100, L;
    for (L = 0; L < NG; L++) if (L !== NAG) {
      var d = Math.abs(gcx[L] - px) / Math.max(lw, 200) * 1000;
      grs[L] = now + Texit + 700 + d * 0.8; end = Math.max(end, Texit + 700 + d * 0.8 + B);
    }
    seq = { t0: now, T1: T1, Tg0: Tg0, Texit: Texit, end: end, glyphs: glyphs, fsz: fsz, dx: left - i0 / GX * w };
    gv.style.opacity = "1";
  }
  function stepSeq() {
    var now = performance.now(), t = now - seq.t0, c;
    var s = clamp01((t - seq.T1) / 800), sb = clamp01((t - (seq.Texit + 200)) / 800);
    var slide = easeIO(s) * (1 - easeIO(sb));
    tint = slide; nax = slide * seq.dx;
    stepGroups(now);
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.clearRect(0, 0, w, h);
    g2.font = seq.fsz + "px Damion, cursive"; g2.fillStyle = "#A9802F";
    var base = (BASE - SPLIT) * lh, n = seq.glyphs.length;
    for (c = 0; c < n; c++) {
      var G = seq.glyphs[c], tg = t - (seq.Tg0 + c * GSTEP);
      if (tg < 0) continue;
      var uu = Math.min(1, tg / GJUMP), gyy = (1 - easeOutBack(uu)) * hs * 0.9, gaa = Math.min(1, uu * 3);
      var te = t - (seq.Texit + (n - 1 - c) * 30);
      if (te > 0) { var v = Math.min(1, te / 600); gyy += hs * 0.7 * v * v; gaa *= 1 - v; }
      if (gaa <= 0.01) continue;
      g2.globalAlpha = gaa; g2.fillText(G.ch, G.x, base + gyy);
    }
    g2.globalAlpha = 1;
    if (t >= seq.end) {
      seq = null; tint = 0; g2.clearRect(0, 0, w, h); gv.style.opacity = "0";
      resetGroups();
      for (var q = 0; q < N; q++) { ox[q] = 0; oy[q] = 0; al[q] = 1; }
      return false;
    }
    return true;
  }

  // ---- uskakování (?efekt=uhyb) ----
  function stepDodge() {
    var R = Math.max(lw * 0.26, 80), A = Math.max(lw * 0.05, 18);
    var rect = cv.getBoundingClientRect();
    var px = ptr.x - rect.left, py = ptr.y - rect.top, energy = 0, c, jj, kk;
    var vsgn = py < hs / 2 ? 1 : -1;
    for (c = 0; c < NX; c++) {
      var tx = 0, ty = 0;
      if (ptr.on) {
        var dx = bx[c] - px, t = Math.max(0, 1 - Math.abs(dx) / R), f = t * t * (3 - 2 * t);
        tx = Math.tanh(dx / (R * 0.3)) * A * f * 0.4;
        ty = vsgn * A * f * 1.1;
      }
      for (jj = 0; jj < NY; jj++) {
        kk = jj * NX + c;
        vx[kk] = (vx[kk] + (tx - ox[kk]) * 0.10) * 0.82;
        vy[kk] = (vy[kk] + (ty - oy[kk]) * 0.10) * 0.82;
        ox[kk] += vx[kk]; oy[kk] += vy[kk];
        energy += Math.abs(ox[kk]) + Math.abs(oy[kk]) + Math.abs(vx[kk]) + Math.abs(vy[kk]);
      }
    }
    return energy > 0.5 || ptr.on;
  }

  function loop() {
    raf = 0;
    var more = MODE === "seq" ? (seq ? stepSeq() : stage ? stepGroups(performance.now()) : false) : stepDodge();
    draw();
    if (more) raf = requestAnimationFrame(loop);
  }
  function wake() { if (ready && !raf) raf = requestAnimationFrame(loop); }

  function inside(e) {                                    // jen rukopisná část, ne VERY VERA
    var r = img.getBoundingClientRect(), top = r.top + r.height * SPLIT, padx = r.width * 0.05;
    return e.clientX > r.left - padx && e.clientX < r.right + padx && e.clientY > top && e.clientY < r.bottom + r.height * 0.05;
  }
  function touch(e) {
    if (MODE === "seq") { poke(e.clientX - cv.getBoundingClientRect().left); return; }
    wake();
  }
  window.addEventListener("pointermove", function (e) {
    var was = ptr.on, ins = inside(e);
    wrap.style.cursor = MODE === "seq" && ins ? "pointer" : "";
    ptr.x = e.clientX; ptr.y = e.clientY;
    if (MODE === "seq") return;                                   // v hlavním režimu se reaguje jen na klepnutí/kliknutí
    ptr.on = ins && (e.pointerType !== "touch" || ptr.down);
    if (ptr.on && !was) touch(e); else if (ptr.on) wake();
  }, { passive: true });
  window.addEventListener("pointerdown", function (e) {
    ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.on = inside(e); if (ptr.on) touch(e);
  }, { passive: true });
  function up() { ptr.down = false; ptr.on = false; wake(); }
  window.addEventListener("pointerup", up, { passive: true });
  window.addEventListener("pointercancel", up, { passive: true });
  document.addEventListener("pointerleave", up);

  var rt = 0;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (!seq && !stage) layout(); }, 150); });
  function start() {
    var p = document.fonts && document.fonts.load ? document.fonts.load("40px Damion", "s nic nezlomí!") : Promise.resolve();
    p.then(layout, layout);
  }
  if (img.complete && img.naturalWidth) start(); else img.addEventListener("load", start);
})();
