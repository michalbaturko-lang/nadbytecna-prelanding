// Odeslání do Supabase. Insert bez čtení řádku zpět, id vzniká v prohlížeči.
(function (global) {
  "use strict";
  var MIN_MS = 3000;

  function cfg() {
    var c = global.NADBYTECNA_SUPABASE || {};
    return { url: String(c.url || "").replace(/\/$/, ""), key: String(c.key || "") };
  }

  function headers(extra) {
    var c = cfg();
    var h = { apikey: c.key, Authorization: "Bearer " + c.key };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  function gate(hp, started) {
    if (hp && String(hp.value || "").trim()) return "bot";
    if (Date.now() - started < MIN_MS) return "fast";
    return "";
  }

  // fetch s limitem; na slabém signálu se tlačítko nezasekne navždy
  function timed(url, init, ms) {
    if (typeof AbortController === "undefined") return fetch(url, init);
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms);
    init.signal = ctl.signal;
    return fetch(url, init).then(function (res) {
      clearTimeout(timer);
      return res;
    }, function (err) {
      clearTimeout(timer);
      throw ctl.signal.aborted ? new Error("timeout") : err;
    });
  }

  function insertRow(table, row) {
    var c = cfg();
    if (!c.url || !c.key) return Promise.reject(new Error("config"));
    return timed(c.url + "/rest/v1/" + table, {
      method: "POST",
      headers: headers({ "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    }, 30000).then(function (res) {
      // 409 = stejné id už v databázi je (opakované odeslání po výpadku odpovědi) -> uloženo
      if (!res.ok && res.status !== 409) throw new Error("insert");
    });
  }

  function audioType(blob) {
    var base = String((blob && blob.type) || "").split(";")[0].trim().toLowerCase();
    if (base.indexOf("audio/") === 0) return base;
    if (base.indexOf("webm") >= 0) return "audio/webm";
    return "audio/mp4";
  }

  function uploadAudio(id, blob, filename) {
    var c = cfg();
    if (!c.url || !c.key) return Promise.reject(new Error("config"));
    var type = audioType(blob);
    var safe = String(filename || "hlas").split(/[/\\]/).pop().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 80);
    if (!safe) safe = type.indexOf("webm") >= 0 ? "hlas.webm" : "hlas.m4a";
    var path = id + "/" + safe;
    return timed(c.url + "/storage/v1/object/story-audio/" + id + "/" + encodeURIComponent(safe), {
      method: "POST",
      headers: headers({ "Content-Type": type, "x-upsert": "false" }),
      body: blob,
    }, 180000).then(function (res) {
      if (res.ok) return path;
      // soubor se stejným id už ve storage je (opakování po výpadku) -> použít ho
      return res.text().then(function (t) {
        if (res.status === 409 || /Duplicate|already exists/i.test(t)) return path;
        throw new Error("upload");
      }, function () { throw new Error("upload"); });
    });
  }

  function ping(path, init) {
    try {
      fetch(path, init).catch(function () {});
    } catch (e) {}
  }

  function done(table, id, opts) {
    ping("/api/notify/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: table, id: id }),
    });
    ping("/api/triage/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: table, id: id }),
    });
    if (opts && opts.audio) {
      var blob = opts.audio;
      var name = opts.filename || "hlas.webm";
      ping("/api/transcribe/", {
        method: "POST",
        headers: {
          "Content-Type": (blob && blob.type) || "application/octet-stream",
          "x-story-id": id,
          "x-audio-name": encodeURIComponent(name),
        },
        body: blob,
      });
    }
    var ads = global.NadbytecnaAds;
    if (!ads) return;
    if (table === "stories" && ads.story) ads.story();
    if (table === "help_offers" && ads.help) ads.help();
  }

  global.NadbytecnaSubmit = {
    gate: gate,
    insertRow: insertRow,
    uploadAudio: uploadAudio,
    done: done,
    uuid: function () { return crypto.randomUUID(); },
    timeoutMessage: "Spojení je pomalé a odeslání nedoběhlo. Zkus to prosím znovu.",
  };
})(window);
