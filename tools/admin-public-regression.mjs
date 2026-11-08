import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
const root = path.resolve(new URL("../", import.meta.url).pathname),
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "nadbytecna-public-baseline-"));
const baseline = "c237d5b6220841e15048c2029ab61391afe67ca2";
const hash = (p) =>
  crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
try {
  const archive = execFileSync("git", ["archive", baseline], {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  execFileSync("tar", ["-x", "-C", temp], { input: archive });
  fs.symlinkSync(
    path.join(root, "node_modules"),
    path.join(temp, "node_modules"),
  );
  for (const cwd of [temp, root])
    execFileSync(process.execPath, ["build.mjs"], {
      cwd,
      env: { ...process.env, PHASE1: "1" },
      stdio: "pipe",
    });
  const pages = [
    "index.html",
    "coming-soon/index.html",
    "zasady/index.html",
    "sdilet-pribeh/index.html",
    "mohu-pomoci/index.html",
    "potrebuji-pomoc/index.html",
    "ochrana-osobnich-udaju/index.html",
    "pravidla-zverejnovani/index.html",
    "kontakt/index.html",
  ];
  for (const p of pages) {
    const before = fs.readFileSync(path.join(temp, "dist", p), "utf8");
    let after = fs.readFileSync(path.join(root, "dist", p), "utf8");
    after = after.replace(
      /<div class="consent"><input id="(?:sdilet|pomoc|potrebuji)-age" type="checkbox"(?: disabled)?><label for="(?:sdilet|pomoc|potrebuji)-age">Je mi 18 let<\/label><\/div>\n/g,
      "",
    );
    assert.equal(after, before, p + " changed beyond age consent");
  }
  const assets = [
    "cookies.js",
    "fluid.js",
    "og-v2.jpg",
    "img/nadbytecna-lockup.svg",
    "launch-form.js",
  ];
  for (const p of assets)
    assert.equal(
      hash(path.join(root, "dist", p)),
      hash(path.join(temp, "dist", p)),
      p,
    );
  fs.writeFileSync(
    path.join(root, "docs/admin/public-regression.json"),
    JSON.stringify(
      {
        baseline,
        date: "2026-11-07",
        pagesCompared: pages,
        onlyAllowedHtmlChange: "18+ checkbox in story/help forms",
        unchangedAssets: assets,
        result: "PASS",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Public regression passed:",
    pages.length,
    "pages,",
    assets.length,
    "assets",
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
