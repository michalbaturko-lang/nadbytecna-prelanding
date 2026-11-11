// Only login credentials and their deadline are persisted, never mailbox/story data.
(function (global) {
  "use strict";
  var key = "nadbytecna-admin", lifetime = 30 * 24 * 3600e3, memory = null;
  function store(name) { try { return global[name]; } catch (_) { return null; } }
  function remove(storage) { try { if (storage) storage.removeItem(key); } catch (_) {} }
  function clear() { memory = null; remove(store("localStorage")); remove(store("sessionStorage")); }
  function valid(s) {
    return s && typeof s.access_token === "string" && s.access_token &&
      (s.refresh_token == null || typeof s.refresh_token === "string") &&
      Number.isFinite(s.remember_until) && s.remember_until > Date.now();
  }
  function save(s) {
    if (!s) { clear(); return; }
    var value = { access_token: s.access_token, refresh_token: s.refresh_token,
      expires_at: s.expires_at, remember_until: s.remember_until == null ? Date.now() + lifetime : s.remember_until };
    if (!valid(value)) { clear(); return; }
    var names = ["localStorage", "sessionStorage"];
    for (var i = 0; i < names.length; i++) {
      try {
        var target = store(names[i]); if (!target) continue;
        target.setItem(key, JSON.stringify(value)); memory = null;
        if (i === 0) remove(store("sessionStorage"));
        return;
      } catch (_) {}
    }
    memory = value;
  }
  function load() {
    var names = ["localStorage", "sessionStorage"];
    for (var i = 0; i < names.length; i++) {
      try {
        var target = store(names[i]), raw = target && target.getItem(key);
        if (!raw) continue;
        var s = JSON.parse(raw);
        // Migrate an existing tab-scoped login once. Server revocation still applies.
        if (i === 1 && s && !s.remember_until) s.remember_until = Date.now() + lifetime;
        if (!valid(s)) { clear(); return null; }
        if (i === 1) save(s);
        return s;
      } catch (_) { if (raw) { clear(); return null; } }
    }
    if (valid(memory)) return memory;
    memory = null; return null;
  }
  global.NadbytecnaAdminSession = { load: load, save: save, clear: clear, key: key, lifetime: lifetime };
})(window);
