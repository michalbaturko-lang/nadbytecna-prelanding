// Příběh Věry: stejný záměr jako přehrávač na veryvera22.cz.
// Video startuje se zvukem. Když prohlížeč autoplay se zvukem zablokuje, hraje potichu
// a zvuk se zapne při první interakci se stránkou. Pauza a další přehrání jen středovým tlačítkem.
// Klepnutí do obrazu nic nepauzuje a zvuk nevypíná. Bez JavaScriptu zůstanou nativní ovládací prvky.
(function () {
  "use strict";

  function arm(video) {
    var frame = video.closest(".vid-frame");
    if (!frame || frame.dataset.veraReady) return;
    frame.dataset.veraReady = "1";
    var btn = frame.querySelector(".vid-pp");
    var userPaused = false;
    var gen = 0;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var allowAuto = !reduce;

    video.controls = false;
    video.playsInline = true;
    frame.classList.add("is-ready");
    if (btn) btn.hidden = false;

    function setUi() {
      var paused = video.paused || video.ended;
      frame.classList.toggle("is-paused", paused);
      if (!btn) return;
      btn.setAttribute("aria-pressed", paused ? "true" : "false");
      btn.setAttribute("aria-label", video.ended ? "Přehrát znovu" : paused ? "Přehrát" : "Pozastavit");
    }

    function playWithSound() {
      if (userPaused) return;
      video.muted = false;
      var attempt = ++gen;
      var pending = video.play();
      if (!pending || !pending.then) {
        setUi();
        return;
      }
      pending.then(function () {
        if (attempt !== gen || userPaused) return;
        setUi();
      }).catch(function () {
        if (attempt !== gen || userPaused) return;
        if (!video.paused && !video.muted) {
          setUi();
          return;
        }
        video.muted = true;
        var quiet = video.play();
        if (quiet && quiet.catch) quiet.catch(function () {});
        setUi();
      });
    }

    if (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (video.paused || video.ended) {
          userPaused = false;
          allowAuto = true;
          if (video.ended) {
            try { video.currentTime = 0; } catch (e) {}
          }
          playWithSound();
        } else {
          userPaused = true;
          gen += 1;
          video.pause();
          setUi();
        }
      });
    }

    video.addEventListener("play", setUi);
    video.addEventListener("pause", setUi);
    video.addEventListener("ended", setUi);

    if (allowAuto && "IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (userPaused) return;
          if (entry.isIntersecting) playWithSound();
          else video.pause();
        });
      }, { threshold: 0.35 }).observe(frame);
    } else if (allowAuto) {
      playWithSound();
    } else {
      setUi();
    }

    function onFirstGesture(ev) {
      var target = ev && ev.target;
      var onButton = btn && target && (target === btn || btn.contains(target));
      if (userPaused && !onButton) return;
      video.muted = false;
      document.removeEventListener("pointerdown", onFirstGesture, true);
      document.removeEventListener("keydown", onFirstGesture, true);
      if (!onButton && !userPaused && video.paused) playWithSound();
    }
    document.addEventListener("pointerdown", onFirstGesture, true);
    document.addEventListener("keydown", onFirstGesture, true);
    setUi();
  }

  function init() {
    var videos = document.querySelectorAll("[data-vera-video]");
    for (var i = 0; i < videos.length; i++) arm(videos[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
