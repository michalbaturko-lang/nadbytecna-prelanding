// Příběh Věry: stejný záměr jako přehrávač na veryvera22.cz.
// Video startuje se zvukem. Potichu spadne jen když play() odmítne politika autoplay (NotAllowedError);
// zvuk se pak zapne při první interakci se stránkou. Jiná chyba (soubor ještě není ready, AbortError)
// počká na canplay/loadeddata a zkusí znovu se zvukem. Pauza a další přehrání jen středovým tlačítkem.
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
    var retryGen = 0;
    var soundRetries = 0;
    var SOUND_RETRY_LIMIT = 5;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var allowAuto = !reduce;
    var wantPlay = allowAuto;

    video.preload = "auto";
    video.muted = false;
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

    function retryUnmuted() {
      if (userPaused || !wantPlay || soundRetries >= SOUND_RETRY_LIMIT) return;
      soundRetries += 1;
      var token = ++retryGen;
      function go() {
        video.removeEventListener("canplay", go);
        video.removeEventListener("loadeddata", go);
        if (token !== retryGen) return;
        retryGen += 1;
        if (userPaused || !wantPlay) return;
        playWithSound();
      }
      video.addEventListener("canplay", go);
      video.addEventListener("loadeddata", go);
      // canplay/loadeddata neodešlou se znovu, když už ten stav nastal.
      if (video.readyState >= 3) setTimeout(go, 0);
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
        soundRetries = 0;
        retryGen += 1;
        setUi();
      }).catch(function (err) {
        if (attempt !== gen || userPaused) return;
        if (!video.paused && !video.muted) {
          setUi();
          return;
        }
        if (err && err.name === "NotAllowedError") {
          retryGen += 1;
          video.muted = true;
          var quiet = video.play();
          if (quiet && quiet.catch) quiet.catch(function () {});
          setUi();
          return;
        }
        retryUnmuted();
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
          wantPlay = true;
          soundRetries = 0;
          if (video.ended) {
            try { video.currentTime = 0; } catch (e) {}
          }
          playWithSound();
        } else {
          userPaused = true;
          gen += 1;
          retryGen += 1;
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
          if (entry.isIntersecting) {
            wantPlay = true;
            playWithSound();
          } else {
            wantPlay = false;
            retryGen += 1;
            video.pause();
          }
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
      if (!onButton && !userPaused && video.paused) {
        wantPlay = true;
        playWithSound();
      }
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
