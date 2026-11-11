// A short-lived PKCE proof is shared across tabs independently of the remembered login.
(function (global) {
  "use strict";
  var key = "nadbytecna-admin-pkce";
  var lifetime = 15 * 60 * 1000;
  function stores() {
    var list = [];
    try { if (global.localStorage) list.push(global.localStorage); } catch (_) {}
    try { if (global.sessionStorage) list.push(global.sessionStorage); } catch (_) {}
    return list;
  }
  function valid(value) {
    return value && typeof value.verifier === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value.verifier) &&
      Number.isFinite(value.at) && value.at <= Date.now() && Date.now() - value.at < lifetime;
  }
  function clear(expected) {
    stores().forEach(function (storage) {
      try {
        var value = JSON.parse(storage.getItem(key));
        if (!expected || !valid(value) || value.verifier === expected) storage.removeItem(key);
      } catch (_) { try { storage.removeItem(key); } catch (_) {} }
    });
  }
  function read() {
    var list = stores();
    for (var i = 0; i < list.length; i++) {
      try {
        var value = JSON.parse(list[i].getItem(key));
        if (valid(value)) return value.verifier;
        list[i].removeItem(key);
      } catch (_) { try { list[i].removeItem(key); } catch (_) {} }
    }
    return null;
  }
  function save(verifier) {
    var value = { verifier: verifier, at: Date.now() };
    if (!valid(value)) return false;
    clear();
    var list = stores();
    for (var i = 0; i < list.length; i++) {
      try { list[i].setItem(key, JSON.stringify(value)); return true; } catch (_) {}
    }
    return false;
  }
  global.NadbytecnaAdminPkce = { save: save, read: read, clear: clear };
})(window);
