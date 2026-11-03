// Logo, které reaguje na dotek. Bez knihoven, bez třetích stran; WebGL mřížka nad obrázkem.
//  výchozí „rozpad“: dotek rozsype písmena (padají a mizí od místa dotyku), pak se zdola složí zpátky.
//                    Po složení se řádek pod logem změní na „Nás nic nezlomí.“
//  ?efekt=uhyb      logo uskakuje před prstem a vrací se.
// Bez WebGL nebo při „omezit pohyb“ zůstává obyčejný obrázek.
(function () {
  "use strict";
  var img = document.querySelector("img.logo");
  if (!img) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var MODE = /[?&]efekt=uhyb/.test(location.search) ? "dodge" : "crumble";

  var MX = 0.16, MY = MODE === "crumble" ? 0.7 : 0.35;   // okraj kolem loga (podíl šířky / výšky)
  var GX = 96, GY = 26;
  var wrap = document.createElement("span");
  wrap.style.cssText = "position:relative;display:block;line-height:0;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none";
  img.parentNode.insertBefore(wrap, img);
  wrap.appendChild(img);
  var cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:absolute;pointer-events:none;opacity:0;transition:opacity .25s";
  wrap.appendChild(cv);
  var gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return;

  var vs = "attribute vec2 p;attribute vec2 t;attribute float a;varying vec2 v;varying float q;uniform vec2 s;" +
    "void main(){v=t;q=a;gl_Position=vec4(p.x/s.x*2.0-1.0,1.0-p.y/s.y*2.0,0.0,1.0);}";
  var fs = "precision mediump float;varying vec2 v;varying float q;uniform sampler2D u;void main(){gl_FragColor=texture2D(u,v)*q;}";
  function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; }
  var pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);

  var W = 0, H = 0, dpr = 1, ox, oy, vx, vy, bx, by, pos, al, tex;
  var NX = GX + 1, NY = GY + 1, N = NX * NY;
  var tc = new Float32Array(N * 2);
  var i, j;
  for (j = 0; j < NY; j++) for (i = 0; i < NX; i++) { tc[(j * NX + i) * 2] = i / GX; tc[(j * NX + i) * 2 + 1] = j / GY; }
  var ind = [];
  for (j = 0; j < GY; j++) for (i = 0; i < GX; i++) { var a0 = j * NX + i; ind.push(a0, a0 + 1, a0 + NX, a0 + 1, a0 + NX + 1, a0 + NX); }
  var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ind), gl.STATIC_DRAW);
  var pb = gl.createBuffer(), tb = gl.createBuffer(), ab = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tb); gl.bufferData(gl.ARRAY_BUFFER, tc, gl.STATIC_DRAW);
  var lt = gl.getAttribLocation(pr, "t"), lp = gl.getAttribLocation(pr, "p"), la = gl.getAttribLocation(pr, "a");
  var us = gl.getUniformLocation(pr, "s");
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  var ready = false, w = 0, h = 0, lw = 0, lh = 0;
  var ptr = { x: -1e4, y: -1e4, down: false, on: false };
  var raf = 0;

  // ---- rozpad ----
  var lead = document.querySelector(".lead"), leadOrig = lead ? lead.textContent : "";
  var crumble = null;                // { t0, px, fs:[], rs:[], end }
  var F = 1000, B = 900;              // pád / složení v ms
  function startCrumble(px) {
    if (crumble) return;
    var now = performance.now(), fsArr = [], rsArr = [], dmax = 0, d, c;
    var spread = Math.max(lw, 200) * 1.0;              // rychlost vlny: celé slovo za ~0,9 s
    for (c = 0; c < NX; c++) {
      d = Math.abs(bx[c] - px) / spread * 1500 + Math.random() * 20;
      fsArr.push(d); if (d > dmax) dmax = d;
    }
    for (c = 0; c < NX; c++) rsArr.push(dmax + F + 350 + fsArr[c] * 0.8);
    var end = 0; for (c = 0; c < NX; c++) end = Math.max(end, rsArr[c] + B);
    crumble = { t0: now, fs: fsArr, rs: rsArr, end: end };
  }
  function easeOutBack(x) { var c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function stepCrumble() {
    var t = performance.now() - crumble.t0, lhh = lh;
    for (var c = 0; c < NX; c++) {
      var tf = t - crumble.fs[c], tr = t - crumble.rs[c], y = 0, x = 0, a = 1;
      if (tr >= 0) {
        var r = Math.min(1, tr / B), e = easeOutBack(r);
        y = (1 - e) * lhh * 0.45; a = Math.min(1, r * 1.6);
      } else if (tf >= 0) {
        var u = Math.min(1, tf / F);
        y = lhh * 0.8 * u * u; x = 0; a = Math.max(0, 1 - u * 1.15);
      }
      for (var j = 0; j < NY; j++) {
        var k = j * NX + c, tip = 1;
        ox[k] = x; oy[k] = y * (tr >= 0 ? 1 : tip); al[k] = a;
      }
    }
    if (t >= crumble.end) {
      crumble = null;
      for (var k2 = 0; k2 < N; k2++) { ox[k2] = 0; oy[k2] = 0; al[k2] = 1; }
      if (lead && lead.textContent === leadOrig) {
        lead.style.transition = "opacity .35s"; lead.style.opacity = "0";
        setTimeout(function () { lead.textContent = "Nás nic nezlomí."; lead.style.opacity = "1"; }, 350);
      }
      return false;
    }
    return true;
  }

  // ---- uskakování ----
  function stepDodge() {
    var R = Math.max(lw * 0.26, 80), A = Math.max(lw * 0.06, 20);
    var rect = cv.getBoundingClientRect();
    var px = ptr.x - rect.left, py = ptr.y - rect.top, energy = 0, k;
    var vsgn = py < h / 2 ? 1 : -1;
    for (var c = 0; c < NX; c++) {
      var tx = 0, ty = 0;
      if (ptr.on) {
        var dx = bx[c] - px, t = Math.max(0, 1 - Math.abs(dx) / R), f = t * t * (3 - 2 * t);
        tx = Math.tanh(dx / (R * 0.3)) * A * f * 0.4;
        ty = vsgn * A * f * 1.1;
      }
      for (var j = 0; j < NY; j++) {
        k = j * NX + c;
        vx[k] = (vx[k] + (tx - ox[k]) * 0.10) * 0.82;
        vy[k] = (vy[k] + (ty - oy[k]) * 0.10) * 0.82;
        ox[k] += vx[k]; oy[k] += vy[k];
        energy += Math.abs(ox[k]) + Math.abs(oy[k]) + Math.abs(vx[k]) + Math.abs(vy[k]);
      }
    }
    return energy > 0.5 || ptr.on;
  }

  function layout() {
    var r = img.getBoundingClientRect();
    lw = r.width; lh = r.height;
    if (!lw) return;
    w = lw * (1 + 2 * MX); h = lh * (1 + 2 * MY);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.style.width = w + "px"; cv.style.height = h + "px";
    cv.style.left = -lw * MX + "px"; cv.style.top = -lh * MY + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.uniform2f(us, w, h);
    bx = new Float32Array(N); by = new Float32Array(N);
    for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) { bx[j * NX + i] = i / GX * w; by[j * NX + i] = j / GY * h; }
    ox = new Float32Array(N); oy = new Float32Array(N); vx = new Float32Array(N); vy = new Float32Array(N);
    al = new Float32Array(N).fill(1);
    pos = new Float32Array(N * 2);
    var c2 = document.createElement("canvas"); c2.width = cv.width; c2.height = cv.height;
    var x2 = c2.getContext("2d");
    x2.drawImage(img, lw * MX * dpr, lh * MY * dpr, lw * dpr, lh * dpr);
    if (!tex) tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    ready = true;
    draw();
    cv.style.opacity = "1"; img.style.opacity = "0";
  }

  function draw() {
    for (var k = 0; k < N; k++) { pos[k * 2] = bx[k] + ox[k]; pos[k * 2 + 1] = by[k] + oy[k]; }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, tb);
    gl.enableVertexAttribArray(lt); gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ab); gl.bufferData(gl.ARRAY_BUFFER, al, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.drawElements(gl.TRIANGLES, ind.length, gl.UNSIGNED_SHORT, 0);
  }

  function loop() {
    raf = 0;
    var more = MODE === "crumble" ? (crumble ? stepCrumble() : false) : stepDodge();
    draw();
    if (more) raf = requestAnimationFrame(loop);
  }
  function wake() { if (ready && !raf) raf = requestAnimationFrame(loop); }

  function inside(e) {
    var r = img.getBoundingClientRect(), padx = r.width * 0.08, pady = r.height * 0.25;
    return e.clientX > r.left - padx && e.clientX < r.right + padx && e.clientY > r.top - pady && e.clientY < r.bottom + pady;
  }
  function touch(e) {                                   // nový dotek / najetí na logo
    var rect = cv.getBoundingClientRect();
    if (MODE === "crumble") { startCrumble(e.clientX - rect.left); wake(); }
    else wake();
  }
  window.addEventListener("pointermove", function (e) {
    var was = ptr.on;
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.on = inside(e) && (e.pointerType !== "touch" || ptr.down);
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
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(function () { if (!crumble) layout(); }, 150); });
  function start() { layout(); }
  if (img.complete && img.naturalWidth) start(); else img.addEventListener("load", start);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (ready && !crumble) layout(); });
})();
