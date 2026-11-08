// Věřin příběh: celoobrazovkový přehrávač na klepnutí. Bez JavaScriptu odkaz vede na /verin-pribeh/ s běžným přehrávačem.
// Video se nestahuje, dokud na něj člověk neklepne. Zvuk je zapnutý (spouští ho klepnutí).
(function () {
  "use strict";
  if (typeof HTMLDialogElement !== "function") return;
  var SRC = "/video/vera-pribeh-v11.mp4";
  var POSTER = "/video/vera-pribeh-poster-v11.jpg";
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z"/></svg>';
  var X = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.7 7.7 0 0 1 0 11"/></svg>';
  var OFF = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';

  var dlg, video, tap, big, snd, bar, msg, end, replay, opener;

  function build() {
    if (dlg) return;
    dlg = document.createElement("dialog");
    dlg.className = "vp";
    dlg.setAttribute("aria-label", "Věřin příběh");
    dlg.innerHTML =
      '<div class="vp-stage">' +
      '<video class="vp-video" playsinline preload="auto" poster="' + POSTER + '"><source src="' + SRC + '" type="video/mp4"></video>' +
      '<button type="button" class="vp-tap" aria-label="Pozastavit"></button>' +
      '<span class="vp-bigplay" aria-hidden="true" hidden>' + PLAY + '</span>' +
      '<button type="button" class="vp-btn vp-sound" aria-label="Vypnout zvuk">' + ON + '</button>' +
      '<button type="button" class="vp-btn vp-close" aria-label="Zavřít video">' + X + '</button>' +
      '<div class="vp-bar" aria-hidden="true"><i></i></div>' +
      '<p class="vp-msg" role="alert" hidden>Video se nepodařilo načíst. Zkus to prosím znovu.</p>' +
      '<div class="vp-end" hidden>' +
      '<h2>Žádná žena není nadbytečná.</h2>' +
      '<a class="vp-cta" href="/sdilet-pribeh/">Sdílej svůj příběh</a>' +
      '<a class="vp-cta alt" href="/mohu-pomoci/">Mohu pomoci</a>' +
      '<button type="button" class="vp-replay">Přehrát znovu</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    video = dlg.querySelector(".vp-video");
    tap = dlg.querySelector(".vp-tap");
    big = dlg.querySelector(".vp-bigplay");
    snd = dlg.querySelector(".vp-sound");
    bar = dlg.querySelector(".vp-bar i");
    msg = dlg.querySelector(".vp-msg");
    end = dlg.querySelector(".vp-end");
    replay = dlg.querySelector(".vp-replay");

    tap.addEventListener("click", toggle);
    snd.addEventListener("click", function () {
      video.muted = !video.muted;
      snd.innerHTML = video.muted ? OFF : ON;
      snd.setAttribute("aria-label", video.muted ? "Zapnout zvuk" : "Vypnout zvuk");
    });
    dlg.querySelector(".vp-close").addEventListener("click", function () { dlg.close(); });
    replay.addEventListener("click", function () { start(); });

    video.addEventListener("play", function () {
      big.hidden = true;
      msg.hidden = true;
      tap.setAttribute("aria-label", "Pozastavit");
    });
    video.addEventListener("pause", function () {
      if (video.ended) return;
      big.hidden = false;
      tap.setAttribute("aria-label", "Přehrát");
    });
    video.addEventListener("timeupdate", function () {
      if (video.duration) bar.style.transform = "scaleX(" + Math.min(1, video.currentTime / video.duration) + ")";
    });
    video.addEventListener("ended", function () {
      bar.style.transform = "scaleX(1)";
      big.hidden = true;
      end.hidden = false;
      var first = end.querySelector("a");
      if (first) first.focus();
    });
    video.addEventListener("error", fail);
    video.querySelector("source").addEventListener("error", fail);

    dlg.addEventListener("close", function () {
      video.pause();
      document.documentElement.classList.remove("vp-lock");
      if (history.state && history.state.vp) history.back();
      if (opener && opener.focus) opener.focus();
    });
    window.addEventListener("popstate", function () { if (dlg.open) dlg.close(); });
  }

  function fail() {
    big.hidden = false;
    msg.hidden = false;
  }

  function toggle() {
    if (video.paused) play(); else video.pause();
  }

  function play() {
    var p = video.play();
    if (p && typeof p.catch === "function") p.catch(function () { big.hidden = false; });
  }

  function start() {
    end.hidden = true;
    msg.hidden = true;
    bar.style.transform = "scaleX(0)";
    try { video.currentTime = 0; } catch (e) {}
    play();
    tap.focus();
  }

  function open(from) {
    build();
    opener = from;
    document.documentElement.classList.add("vp-lock");
    dlg.showModal();
    try { history.pushState({ vp: 1 }, ""); } catch (e) {}
    start();
  }

  function init() {
    var links = document.querySelectorAll("[data-video-open]");
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute("role", "button");
      links[i].setAttribute("aria-haspopup", "dialog");
      links[i].addEventListener("click", function (ev) {
        if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
        open(ev.currentTarget);
      });
      links[i].addEventListener("keydown", function (ev) {
        if (ev.key === " ") { ev.preventDefault(); open(ev.currentTarget); }
      });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
