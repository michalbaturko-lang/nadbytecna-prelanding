// Migrace na skutečném Postgresu (PGlite): RLS, oprávnění rolí, omezení, retence, výmaz.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = new URL("../supabase/migrations/", import.meta.url);
async function fresh() {
  const db = new PGlite();
  // role jako v Supabase
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;`);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));
  await db.exec(`grant select, insert, update, delete on public.preregistrations to service_role;
    grant execute on function public.purge_preregistrations(), public.erase_preregistration(text) to service_role;`);
  return db;
}
const row = (e, extra = "") => `insert into public.preregistrations (email, email_normalized, consent_version, consent_text${extra ? "," + extra.split("|")[0] : ""}) values ('${e}', lower('${e}'), 'v3', 'text'${extra ? "," + extra.split("|")[1] : ""})`;

test("migrace jdou opakovaně a RLS je zapnuté a vynucené", async () => {
  const db = await fresh();
  for (const f of fs.readdirSync(dir).sort()) await db.exec(fs.readFileSync(new URL(f, dir), "utf8")); // idempotence
  const r = await db.query(`select relrowsecurity, relforcerowsecurity from pg_class where oid='public.preregistrations'::regclass`);
  assert.deepEqual(r.rows[0], { relrowsecurity: true, relforcerowsecurity: true });
});

test("anon a authenticated nemají k tabulce ani funkcím žádný přístup", async () => {
  const db = await fresh();
  await db.exec(row("a@example.cz"));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const q of ["select * from public.preregistrations", row("x@example.cz"), "update public.preregistrations set status='confirmed'", "delete from public.preregistrations", "select public.purge_preregistrations()", "select public.erase_preregistration('a@example.cz')"])
      await assert.rejects(() => db.query(q), /permission denied/, `${role}: ${q.slice(0, 40)}`);
    await db.exec("reset role");
  }
  assert.equal((await db.query("select count(*)::int n from public.preregistrations")).rows[0].n, 1);
});

test("service_role funguje a omezení tabulky drží", async () => {
  const db = await fresh();
  await db.exec("set role service_role");
  await db.exec(row("A@Example.cz"));
  await assert.rejects(() => db.query(row("a@example.cz")), /unique|duplicate/i);                               // duplicita po normalizaci
  await assert.rejects(() => db.query(`insert into public.preregistrations (email,email_normalized,consent_version,consent_text) values ('B@x.cz','B@x.cz','v','t')`), /lower/);
  await assert.rejects(() => db.query(`insert into public.preregistrations (email,email_normalized,consent_version,consent_text,status) values ('c@x.cz','c@x.cz','v','t','hacked')`), /check/);
  await assert.rejects(() => db.query(`insert into public.preregistrations (email,email_normalized,consent_version,consent_text) values ('${"a".repeat(260)}@x.cz','${"a".repeat(260)}@x.cz','v','t')`), /email_len/);
  await assert.rejects(() => db.query(`insert into public.preregistrations (email,email_normalized,consent_version,consent_text) values ('d@x.cz','d@x.cz','v',null)`), /not-null|null value/);
  for (const bad of ["{}", "{a,b,c,d}"]) await assert.rejects(() => db.query(`update public.preregistrations set claims='${bad}' where email_normalized='a@example.cz'`), /claims_len/);
  await db.query(`update public.preregistrations set claims='{a,b,c}', claims_at=now() where email_normalized='a@example.cz'`);
});

test("SQL injection v e-mailu se ukládá jako text, tabulka zůstává", async () => {
  const db = await fresh();
  const evil = "x'); drop table public.preregistrations;--@example.cz";
  await db.query(`insert into public.preregistrations (email,email_normalized,consent_version,consent_text) values ($1,lower($1),'v','t')`, [evil]);
  assert.equal((await db.query("select count(*)::int n from public.preregistrations where email=$1", [evil])).rows[0].n, 1);
});

test("retence: IP hash po expiraci pryč, nepotvrzené po 7 dnech smazané, potvrzené zůstanou; výmaz na požádání", async () => {
  const db = await fresh();
  await db.exec(`
    insert into public.preregistrations (email,email_normalized,consent_version,consent_text,status,ip_hash,ip_hash_expires_at,last_attempt_at) values
     ('old-pending@x.cz','old-pending@x.cz','v','t','pending','h',now()-interval '1 day',now()-interval '8 days'),
     ('new-pending@x.cz','new-pending@x.cz','v','t','pending','h',now()+interval '10 days',now()-interval '2 days'),
     ('old-conf@x.cz','old-conf@x.cz','v','t','confirmed','h',now()-interval '1 day',now()-interval '90 days'),
     ('old-unsub@x.cz','old-unsub@x.cz','v','t','unsubscribed',null,null,now()-interval '90 days');`);
  await db.exec("set role service_role");
  await db.query("select public.purge_preregistrations()");
  const r = (await db.query("select email_normalized e, ip_hash from public.preregistrations order by 1")).rows;
  assert.deepEqual(r.map((x) => x.e), ["new-pending@x.cz", "old-conf@x.cz", "old-unsub@x.cz"]);
  assert.equal(r.find((x) => x.e === "new-pending@x.cz").ip_hash, "h");   // ještě neexpirovalo
  assert.equal(r.find((x) => x.e === "old-conf@x.cz").ip_hash, null);      // expirované vymazáno
  assert.equal((await db.query("select public.erase_preregistration('  OLD-CONF@x.cz ') n")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from public.preregistrations")).rows[0].n, 2);
});
