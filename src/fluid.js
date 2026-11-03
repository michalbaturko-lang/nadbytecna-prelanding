// Logo, které uhýbá před prstem nebo myší: pružná mřížka na WebGL, plynule se vrací zpět.
// Bez WebGL nebo při „omezit pohyb“ zůstává obyčejný obrázek. Žádné knihovny, žádné třetí strany.
(function () {
  "use strict";
  var img = document.querySelector("img.logo");
  if (!img) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var MX = 0.16, MY = 0.55;           // okraj kolem loga (podíl šířky / výšky), aby se tvar mohl vychýlit ven
  var GX = 96, GY = 26;               // hustota mřížky
  var wrap = document.createElement("span");
  wrap.style.cssText = "position:relative;display:block;line-height:0";
  img.parentNode.insertBefore(wrap, img);
  wrap.appendChild(img);
  var cv = document.createElement("canvas");
  cv.setAttribute("aria-hidden", "true");
  cv.style.cssText = "position:absolute;pointer-events:none;opacity:0;transition:opacity .25s";
  wrap.appendChild(cv);
  var gl = cv.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
  if (!gl) return;

  var vs = "attribute vec2 p;attribute vec2 t;varying vec2 v;uniform vec2 s;" +
    "void main(){v=t;gl_Position=vec4(p.x/s.x*2.0-1.0,1.0-p.y/s.y*2.0,0.0,1.0);}";
  var fs = "precision mediump float;varying vec2 v;uniform sampler2D u;void main(){gl_FragColor=texture2D(u,v);}";
  function sh(type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; }
  var pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);

  var W = 0, H = 0, dpr = 1, ox, oy, vx, vy, bx, by, pos, tex, idx;
  var NX = GX + 1, NY = GY + 1, N = NX * NY;
  var tc = new Float32Array(N * 2);
  for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) { tc[(j * NX + i) * 2] = i / GX; tc[(j * NX + i) * 2 + 1] = j / GY; }
  var ind = [];
  for (j = 0; j < GY; j++) for (i = 0; i < GX; i++) { var a = j * NX + i; ind.push(a, a + 1, a + NX, a + 1, a + NX + 1, a + NX); }
  var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(ind), gl.STATIC_DRAW);
  var pb = gl.createBuffer(), tb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tb); gl.bufferData(gl.ARRAY_BUFFER, tc, gl.STATIC_DRAW);
  var lt = gl.getAttribLocation(pr, "t"); gl.enableVertexAttribArray(lt); gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 0, 0);
  var lp = gl.getAttribLocation(pr, "p");
  var us = gl.getUniformLocation(pr, "s");
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  var ready = false, w = 0, h = 0, lw = 0, lh = 0;
  var ptr = { x: -1e4, y: -1e4, px: -1e4, py: -1e4, down: false, on: false };
  var raf = 0, calm = 0;

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
    // základní poloha vrcholů
    bx = new Float32Array(N); by = new Float32Array(N);
    for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) { bx[j * NX + i] = i / GX * w; by[j * NX + i] = j / GY * h; }
    ox = new Float32Array(N); oy = new Float32Array(N); vx = new Float32Array(N); vy = new Float32Array(N);
    pos = new Float32Array(N * 2);
    // textura: logo uprostřed, průhledné okolí
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

  function step() {
    var R = Math.max(lw * 0.14, 46), R2 = R * R;
    var rect = cv.getBoundingClientRect();
    var px = ptr.x - rect.left, py = ptr.y - rect.top;
    var pvx = ptr.px === -1e4 ? 0 : px - (ptr.px - rect.left), pvy = ptr.px === -1e4 ? 0 : py - (ptr.py - rect.top);
    ptr.px = ptr.x; ptr.py = ptr.y;
    var energy = 0;
    for (var k = 0; k < N; k++) {
      var fx = -ox[k] * 0.018, fy = -oy[k] * 0.018;        // pružina zpět na místo
      if (ptr.on) {
        var dx = bx[k] + ox[k] - px, dy = by[k] + oy[k] - py, d2 = dx * dx + dy * dy;
        if (d2 < R2 * 5) {
          var f = Math.exp(-d2 / (R2 * 1.2));
          var d = Math.sqrt(d2) + 1;
          fx += dx / d * f * 1.1 + pvx * f * 0.035;          // odtlačení od prstu + unášení pohybem
          fy += dy / d * f * 1.1 + pvy * f * 0.035;
        }
      }
      vx[k] = (vx[k] + fx) * 0.90; vy[k] = (vy[k] + fy) * 0.90;
    }
    // sousedé se navzájem táhnou: tvar zůstává tekutý, nerozsype se
    for (var j = 0; j < NY; j++) for (var i = 0; i < NX; i++) {
      var q = j * NX + i, sx = 0, sy = 0, c = 0;
      if (i > 0) { sx += ox[q - 1]; sy += oy[q - 1]; c++; }
      if (i < GX) { sx += ox[q + 1]; sy += oy[q + 1]; c++; }
      if (j > 0) { sx += ox[q - NX]; sy += oy[q - NX]; c++; }
      if (j < GY) { sx += ox[q + NX]; sy += oy[q + NX]; c++; }
      vx[q] += (sx / c - ox[q]) * 0.22; vy[q] += (sy / c - oy[q]) * 0.22;
    }
    for (k = 0; k < N; k++) {
      ox[k] += vx[k]; oy[k] += vy[k];
      var m = Math.sqrt(ox[k] * ox[k] + oy[k] * oy[k]), cap = lw * 0.07;
      if (m > cap) { ox[k] *= cap / m; oy[k] *= cap / m; }
      energy += Math.abs(ox[k]) + Math.abs(oy[k]) + Math.abs(vx[k]) + Math.abs(vy[k]);
    }
    return energy;
  }

  function draw() {
    for (var k = 0; k < N; k++) { pos[k * 2] = bx[k] + ox[k]; pos[k * 2 + 1] = by[k] + oy[k]; }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, tb); gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.drawElements(gl.TRIANGLES, ind.length, gl.UNSIGNED_SHORT, 0);
  }

  function loop() {
    raf = 0;
    var e = step();
    draw();
    if (e > 0.5 || ptr.on) raf = requestAnimationFrame(loop);
  }
  function wake() { if (ready && !raf) raf = requestAnimationFrame(loop); }

  function inside(e) {
    var r = img.getBoundingClientRect(), padx = r.width * 0.12, pady = r.height * 0.5;
    return e.clientX > r.left - padx && e.clientX < r.right + padx && e.clientY > r.top - pady && e.clientY < r.bottom + pady;
  }
  window.addEventListener("pointermove", function (e) {
    ptr.x = e.clientX; ptr.y = e.clientY;
    ptr.on = inside(e) && (e.pointerType !== "touch" || ptr.down);
    if (ptr.on) wake();
  }, { passive: true });
  window.addEventListener("pointerdown", function (e) {
    ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.px = -1e4;
    ptr.on = inside(e); if (ptr.on) wake();
  }, { passive: true });
  function up() { ptr.down = false; ptr.on = false; ptr.px = -1e4; wake(); }
  window.addEventListener("pointerup", up, { passive: true });
  window.addEventListener("pointercancel", up, { passive: true });
  document.addEventListener("pointerleave", up);

  var rt = 0;
  window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(layout, 150); });
  function start() { layout(); }
  if (img.complete && img.naturalWidth) start(); else img.addEventListener("load", start);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (ready) layout(); });
})();
