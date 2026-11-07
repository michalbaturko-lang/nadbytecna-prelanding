(() => {
  "use strict";
  const button = document.getElementById("connect-microsoft"),
    status = document.getElementById("connect-status");
  if (!button || !status) return;
  const fragment = new URLSearchParams(location.hash.slice(1));
  let invite = fragment.get("invite") || "";
  history.replaceState(null, "", location.pathname);
  if (button.dataset.ready !== "true") {
    status.textContent =
      "Připojení Microsoftu ještě není nastavené. Požádejte o nový odkaz po dokončení nastavení.";
    invite = "";
    return;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(invite)) {
    status.textContent =
      "Tento odkaz neobsahuje platnou pozvánku. Požádejte o nový připojovací odkaz.";
    invite = "";
    return;
  }
  button.disabled = false;
  status.textContent =
    "Pozvánku použijete až kliknutím. Připojení je určené pouze pro uvedenou schránku.";
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Připravuji přihlášení u Microsoftu…";
    try {
      const response = await fetch("/api/mail-connect/?step=begin", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite }),
      });
      invite = "";
      if (!response.ok) throw new Error();
      const d = await response.json(),
        u = new URL(d.url);
      if (
        u.origin !== "https://login.microsoftonline.com" ||
        !/^\/[0-9a-f-]{36}\/oauth2\/v2\.0\/authorize$/i.test(u.pathname) ||
        u.username ||
        u.password ||
        u.hash
      )
        throw new Error();
      location.assign(u.href);
    } catch {
      invite = "";
      status.textContent =
        "Pozvánka není platná, vypršela nebo připojení není dostupné. Požádejte o nový odkaz. Pokud Microsoft vyžádá schválení správce, nejprve jej zajistěte.";
    }
  });
})();
