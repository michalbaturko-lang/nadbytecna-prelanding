import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  freshAdminDb,
  applyAdminWorkspace,
  ADMIN_SCHEMA,
  seed,
  ADMIN,
  OTHER,
  SESSION,
  STORY,
  OFFER,
} from "./helpers/admin-db.mjs";
let db;
test.before(async () => {
  db = await freshAdminDb();
  await seed(db);
});
test.after(async () => {
  await db?.close();
});
test("admin migration: categories, RLS, anon metadata guard and age", async () => {
  assert.equal(
    (await db.query("select count(*)::int n from categories")).rows[0].n,
    8,
  );
  await db.exec("set role anon");
  for (const table of [
    "stories",
    "help_offers",
    "admin_notes",
    "status_history",
    "matches",
    "categories",
    "admin_audit_log",
    "admin_emails",
    "admins",
    "admin_records",
  ]) {
    await assert.rejects(
      () => db.query(`select * from ${table}`),
      /permission denied/,
    );
    await assert.rejects(
      () => db.query(`delete from ${table}`),
      /permission denied|cannot delete from view/,
    );
  }
  await assert.rejects(
    () =>
      db.query(
        `INSERT INTO stories(email,consent,input_type) VALUES('young@example.invalid',true,'text')`,
      ),
    /row-level|policy/,
  );
  await db.query(
    `INSERT INTO stories(id,email,consent,age_confirmed,input_type,ai_summary,admin_note,admin_category) VALUES('66666666-6666-4666-8666-666666666666','new@example.invalid',true,true,'text','injected','injected','pravni')`,
  );
  await db.exec("reset role");
  const r = (
    await db.query(`select * from stories where email='new@example.invalid'`)
  ).rows[0];
  assert.equal(r.ai_summary, null);
  assert.equal(r.admin_note, null);
  assert.equal(r.admin_category, null);
  assert.ok(r.consent_at);
  assert.ok(r.age_confirmed_at);
  assert.equal(r.consent_version, "2026-11-07-v1");
});
test("help offer keeps the optional greeting from the public form", async () => {
  await db.exec("set role anon");
  await db.query(
    `INSERT INTO help_offers(id,email,full_name,helper_type,help_kinds,message,links,consent,age_confirmed,greeting)
     VALUES('77777777-7777-4777-8777-777777777777','greeting@example.invalid','Celé Jméno','professional',ARRAY['pravni'],'Nabídka.','{"web":"https://example.invalid"}',true,true,'Káťa')`,
  );
  await db.exec("reset role");
  const row = (
    await db.query(
      "select greeting, links from help_offers where id='77777777-7777-4777-8777-777777777777'",
    )
  ).rows[0];
  assert.equal(row.greeting, "Káťa");
  assert.match(row.links, /example\.invalid/);
  const view = (
    await db.query(
      "select greeting, full_name from admin_records where id='77777777-7777-4777-8777-777777777777'",
    )
  ).rows[0];
  assert.equal(view.greeting, "Káťa");
  assert.equal(view.full_name, "Celé Jméno");
  const search = (
    await db.query(
      "select search_document::text as t from help_offers where id='77777777-7777-4777-8777-777777777777'",
    )
  ).rows[0].t;
  assert.match(search, /kata/i);
});
test("audio consent v2 stores the displayed wording; old clients and historical snapshots retain v1", async () => {
  const previous = (await db.query("select consent_version,consent_texts from stories where id=$1", [STORY])).rows[0];
  for (const version of [null, "2026-11-08-audio-v2", "forged-version"]) {
    const email = "consent-" + (version || "legacy") + "@example.invalid";
    try {
      await db.exec("set role anon");
      await db.query(`INSERT INTO stories(email,consent,age_confirmed,input_type,consent_transcript,consent_version,consent_texts)
        VALUES($1,true,true,'recording',true,$2,'{"transcript":"forged text"}')`, [email, version]);
    } finally {
      await db.exec("reset role");
    }
    const saved = (await db.query("select consent_version,consent_texts from stories where email=$1", [email])).rows[0];
    const v2 = version === "2026-11-08-audio-v2";
    assert.equal(saved.consent_version, v2 ? version : "2026-11-07-v1");
    const displayed = fs.readFileSync(new URL("../lib/phase1-html.js", import.meta.url), "utf8").match(/<label for="sdilet-prepis">([^<]+)<\/label>/)[1];
    assert.equal(saved.consent_texts.transcript, v2 ? displayed : "Souhlasím s přepisem hlasové zprávy na text. U audia povinné.");
  }
  assert.deepEqual((await db.query("select consent_version,consent_texts from stories where id=$1", [STORY])).rows[0], previous);
  await assert.rejects(db.query("update stories set consent_version='changed' where email='consent-2026-11-08-audio-v2@example.invalid'"), /consent_immutable/);
  await db.query("delete from stories where email=ANY($1::text[])", [["consent-legacy@example.invalid", "consent-2026-11-08-audio-v2@example.invalid", "consent-forged-version@example.invalid"]]);
});

test("allowlist enrollment and session idle expiry; RLS outsiders see no rows", async () => {
  await db.exec("set role service_role");
  assert.equal(
    (
      await db.query(`select admin_access($1,'other@example.invalid',$2) ok`, [
        OTHER,
        SESSION,
      ])
    ).rows[0].ok,
    false,
  );
  assert.equal(
    (
      await db.query(`select admin_access($1,'admin@example.invalid',$2) ok`, [
        ADMIN,
        SESSION,
      ])
    ).rows[0].ok,
    true,
  );
  await db.exec("reset role");
  await db.query(
    `select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,
    [OTHER, JSON.stringify({ session_id: SESSION })],
  );
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select count(*)::int n from stories")).rows[0].n,
    0,
  );
  await assert.rejects(
    () =>
      db.query(`select admin_access($1,'admin@example.invalid',$2)`, [
        ADMIN,
        SESSION,
      ]),
    /permission denied/,
  );
  await assert.rejects(
    () => db.query("update stories set status='published'"),
    /permission denied/,
  );
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [
    ADMIN,
  ]);
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select count(*)::int n from stories")).rows[0].n,
    2,
  );
  await db.exec("reset role");
  await db.exec(
    `UPDATE private.admin_sessions SET last_seen=now()-interval '13 hours'`,
  );
  await db.exec("set role authenticated");
  assert.equal(
    (await db.query("select count(*)::int n from stories")).rows[0].n,
    0,
  );
  await db.exec("reset role");
  await db.exec("set role service_role");
  assert.equal(
    (
      await db.query(`select admin_access($1,'admin@example.invalid',$2) ok`, [
        ADMIN,
        SESSION,
      ])
    ).rows[0].ok,
    false,
  );
  await db.exec("reset role");
});
test("atomic workflow, publish gates, classification precedence, notes and text-free audit", async () => {
  await db.exec("set role service_role");
  const mutate = (patch) =>
    db.query(
      `select admin_mutate('stories',$1,$2,'admin@example.invalid',$3)`,
      [STORY, ADMIN, JSON.stringify(patch)],
    );
  await mutate({
    admin_category: "pravni",
    admin_urgency: "high",
    status: "in_progress",
  });
  await mutate({
    ai_category: "terapie",
    ai_urgency: "low",
    ai_summary: "SYNTHETIC_SECRET_SUMMARY",
    ai_at: new Date().toISOString(),
  });
  const r = (
    await db.query(`select category,urgency from admin_records where id=$1`, [
      STORY,
    ])
  ).rows[0];
  assert.equal(r.category, "pravni");
  assert.equal(r.urgency, "high");
  await assert.rejects(() => mutate({ ai_category: "invalid" }), /category/);
  await assert.rejects(() => mutate({ consent_publish: true }), /field/);
  await assert.rejects(
    () =>
      db.query(
        `select admin_mutate('help_offers',$1,$2,'admin@example.invalid','{"status":"published"}')`,
        [OFFER, ADMIN],
      ),
    /publish_consent/,
  );
  await mutate({ status: "published" });
  await db.query(
    `select admin_note_save('stories',$1,$2,'admin@example.invalid','SYNTHETIC_SECRET_NOTE půjčka')`,
    [STORY, ADMIN],
  );
  const n = (await db.query("select * from admin_notes")).rows[0];
  await assert.rejects(
    () =>
      db.query(
        `select admin_note_save('stories',$1,$2,'other@example.invalid','change',$3)`,
        [STORY, OTHER, n.id],
      ),
    /own_note_only/,
  );
  assert.equal(
    (
      await db.query(
        `select count(*)::int n from stories where search_document @@ plainto_tsquery('simple','pujcka')`,
      )
    ).rows[0].n,
    1,
  );
  const audit = JSON.stringify(
    (await db.query("select * from admin_audit_log")).rows,
  );
  assert.ok(!audit.includes("SYNTHETIC_SECRET"));
  assert.equal(
    (await db.query("select count(*)::int n from status_history")).rows[0].n,
    2,
  );
  await db.query(
    `select admin_match_save($1,$2,'confirmed',$3,'admin@example.invalid')`,
    [STORY, OFFER, ADMIN],
  );
  await db.exec("reset role");
});
test("GDPR person erasure cascades notes, history and matches and preserves only hash", async () => {
  await db.exec("set role service_role");
  const data = (
    await db.query(`select admin_person('osoba@example.invalid') p`)
  ).rows[0].p;
  assert.equal(data.records.length, 1);
  assert.equal(data.notes.length, 1);
  await db.query(
    `select admin_erase('osoba@example.invalid',$1,$2,'admin@example.invalid',true)`,
    ["a".repeat(64), ADMIN],
  );
  await assert.rejects(
    () =>
      db.query(
        `select admin_mutate('stories',$1,$2,'admin@example.invalid','{"status":"new"}')`,
        [STORY, ADMIN],
      ),
    /missing/,
  );
  await db.query(
    `INSERT INTO stories(email,consent,input_type,story_text) VALUES('osoba@example.invalid',true,'text','Nový syntetický záznam po zahájení výmazu.')`,
  );
  await db.query(
    `select admin_erase('osoba@example.invalid',$1,$2,'admin@example.invalid',false)`,
    ["a".repeat(64), ADMIN],
  );
  for (const table of ["admin_notes", "status_history", "matches"])
    assert.equal(
      (await db.query(`select count(*)::int n from ${table}`)).rows[0].n,
      0,
    );
  const audit = JSON.stringify(
    (await db.query("select * from admin_audit_log")).rows,
  );
  assert.ok(!audit.includes(STORY));
  assert.ok(audit.includes("a".repeat(64)));
  assert.equal(
    (
      await db.query(
        `select count(*)::int n from stories where email='osoba@example.invalid'`,
      )
    ).rows[0].n,
    1,
  );
  await db.exec("reset role");
});
test("retention deletes only expired record, preserves published stories and fresh related offers", async () => {
  await db.query(
    `INSERT INTO stories(id,email,created_at,status,consent,consent_publish,age_confirmed,input_type) VALUES('77777777-7777-4777-8777-777777777777','retention@example.invalid',now()-interval '13 months','new',true,true,true,'text'),('88888888-8888-4888-8888-888888888888','retention@example.invalid',now()-interval '13 months','published',true,true,true,'text')`,
  );
  await db.exec(
    `UPDATE stories SET status='published' WHERE id='88888888-8888-4888-8888-888888888888'`,
  );
  await db.query(
    `INSERT INTO help_offers(id,email,created_at,last_contact_at,consent,helper_type) VALUES('99999999-9999-4999-8999-999999999999','retention@example.invalid',now()-interval '25 months',now(),true,'professional')`,
  );
  await db.exec("set role service_role");
  for (const [id, expected] of [
    ["77777777-7777-4777-8777-777777777777", true],
    ["88888888-8888-4888-8888-888888888888", false],
  ]) {
    const r = (
      await db.query(`select admin_retention_mark('stories',$1) p`, [id])
    ).rows[0].p;
    assert.equal(r !== null, expected);
    if (expected)
      assert.equal(
        (await db.query(`select admin_retention_finish('stories',$1) ok`, [id]))
          .rows[0].ok,
        true,
      );
  }
  assert.equal(
    (
      await db.query(
        `select admin_retention_mark('help_offers','99999999-9999-4999-8999-999999999999') p`,
      )
    ).rows[0].p,
    null,
  );
  assert.equal(
    (
      await db.query(
        `select count(*)::int n from help_offers where email='retention@example.invalid'`,
      )
    ).rows[0].n,
    1,
  );
  await db.exec("reset role");
});
test("audio retention claims only transcribed or 30-day-old audio", async () => {
  for (const [i, age, transcript] of [
    [0, 31, null],
    [1, 2, "Syntetický přepis"],
    [2, 2, null],
  ])
    await db.query(
      `INSERT INTO stories(id,email,created_at,audio_path,transcript,consent,input_type) VALUES($1,$2,now()-make_interval(days=>$3),$4,$5,true,'upload')`,
      [
        "a000000" + i + "-0000-4000-8000-000000000000",
        "audio" + i + "@example.invalid",
        age,
        "a000000" + i + "-0000-4000-8000-000000000000/audio.wav",
        transcript,
      ],
    );
  await db.exec("set role service_role");
  const rows = (
    await db.query(
      `select id,audio_path from stories where email like 'audio%@example.invalid' order by email`,
    )
  ).rows;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    assert.equal(
      (
        await db.query(`select admin_audio_retention_claim($1,$2) ok`, [
          r.id,
          r.audio_path,
        ])
      ).rows[0].ok,
      i < 2,
    );
    if (i < 2)
      await db.query(`select admin_audio_retention_finish($1,$2)`, [
        r.id,
        r.audio_path,
      ]);
  }
  assert.equal(
    (
      await db.query(
        `select count(*)::int n from stories where email like 'audio%@example.invalid' and audio_path is not null`,
      )
    ).rows[0].n,
    1,
  );
  await db.exec("reset role");
});
test("automatic AI queue retries at most twice and cannot overwrite manual classification", async () => {
  await db.exec("set role service_role");
  await db.exec(`UPDATE private.ai_jobs SET done=true`);
  await db.exec("reset role");
  await db.query(
    `INSERT INTO stories(id,email,consent,admin_category,admin_urgency,input_type) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','queue@example.invalid',true,'pravni','high','text')`,
  );
  await db.exec("set role service_role");
  for (let i = 0; i < 3; i++) {
    const job = (await db.query("select admin_ai_claim() p")).rows[0].p;
    assert.equal(job.attempt, i + 1);
    await db.query(`select admin_ai_finish('stories',$1,'{}',true)`, [job.id]);
    await db.exec(`UPDATE private.ai_jobs SET available_at=now()`);
  }
  assert.equal((await db.query("select admin_ai_claim() p")).rows[0].p, null);
  await db.query(
    `select admin_ai_finish('stories','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1,false)`,
    [
      JSON.stringify({
        category: "terapie",
        urgency: "low",
        summary: "Syntetické",
        help_type: "Ověřit potřeby",
        model: "test",
      }),
    ],
  );
  const r = (
    await db.query(
      `select category,urgency from admin_records where email='queue@example.invalid'`,
    )
  ).rows[0];
  assert.equal(r.category, "pravni");
  assert.equal(r.urgency, "high");
  await db.exec("reset role");
});

test("migration can be reapplied to populated reconstructed schema", async () => {
  const { readFileSync } = await import("node:fs");
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261108000000_admin_workspace.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261111120000_help_offer_greeting.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    (await db.query("select count(*)::int n from categories")).rows[0].n,
    8,
  );
  assert.equal(
    (
      await db.query(
        "select greeting from admin_records where id='77777777-7777-4777-8777-777777777777'",
      )
    ).rows[0].greeting,
    "Káťa",
  );
});

test("anon cannot bind a story to another story's audio or unsafe filenames", async () => {
  await db.exec("set role anon");
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  for (const path of [
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd/victim.wav",
    id + "/..",
    id + "/.",
    id + "/nested/file.wav",
  ]) {
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO stories(id,email,consent,age_confirmed,input_type,audio_path) VALUES($1,'binding@example.invalid',true,true,'upload',$2)`,
          [id, path],
        ),
      /audio_path/,
    );
  }
  await db.query(
    `INSERT INTO stories(id,email,consent,age_confirmed,input_type,audio_path) VALUES($1,'binding@example.invalid',true,true,'upload',$2)`,
    [id, id + "/audio.wav"],
  );
  await db.exec("reset role");
});

test("status-only saves do not confirm AI classification and clearing both overrides removes confirmation", async () => {
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  await db.query(
    `INSERT INTO stories(id,email,consent,input_type) VALUES($1,'classification@example.invalid',true,'text')`,
    [id],
  );
  await db.exec("set role service_role");
  const update = (patch) =>
    db.query(
      `select admin_mutate('stories',$1,$2,'admin@example.invalid',$3)`,
      [id, ADMIN, JSON.stringify(patch)],
    );
  await update({
    status: "in_progress",
    admin_category: null,
    admin_urgency: null,
  });
  let r = (
    await db.query("select classified_at from stories where id=$1", [id])
  ).rows[0];
  assert.equal(r.classified_at, null);
  await update({ admin_category: "pravni" });
  r = (await db.query("select classified_at from stories where id=$1", [id]))
    .rows[0];
  assert.ok(r.classified_at);
  await update({ admin_category: null, admin_urgency: null });
  r = (
    await db.query(
      "select classified_at,classified_by,classified_email from stories where id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(r.classified_at, null);
  assert.equal(r.classified_by, null);
  assert.equal(r.classified_email, null);
  await db.exec("reset role");
});
test("workspace applies over captured production metadata without auth.users grants or legacy table", async () => {
  const productionBase = await freshAdminDb({ applyWorkspace: false });
  try {
    const tables = [...new Set(ADMIN_SCHEMA.columns.map((c) => c.table))];
    const actual = (
      await productionBase.query(
        `SELECT table_name AS "table",column_name AS "column",data_type AS "type",udt_name AS udt,column_default AS "default",is_nullable AS nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1::text[])`,
        ["{" + tables.join(",") + "}"],
      )
    ).rows;
    const sorted = (rows) =>
      rows
        .slice()
        .sort((a, b) =>
          (a.table + "." + a.column).localeCompare(b.table + "." + b.column),
        );
    assert.deepEqual(sorted(actual), sorted(ADMIN_SCHEMA.columns));
    assert.equal(
      (
        await productionBase.query(
          "SELECT to_regclass('public.preregistrations') name",
        )
      ).rows[0].name,
      null,
    );
    assert.equal(
      (
        await productionBase.query(
          "SELECT has_table_privilege('service_role','auth.users','SELECT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await assert.rejects(
      () =>
        productionBase.query(
          "INSERT INTO stories(email,consent) VALUES('strict@example.invalid',true)",
        ),
      /input_type.*not-null|null value.*input_type/,
    );
    await assert.rejects(
      () =>
        productionBase.query(
          "INSERT INTO help_offers(email,consent) VALUES('strict@example.invalid',true)",
        ),
      /helper_type.*not-null|null value.*helper_type/,
    );
    await applyAdminWorkspace(productionBase);
    assert.equal(
      (
        await productionBase.query(
          "SELECT to_regclass('public.preregistrations') name",
        )
      ).rows[0].name,
      null,
    );
    await productionBase.exec("SET ROLE service_role");
    await assert.rejects(
      () => productionBase.query("SELECT * FROM auth.users"),
      /permission denied/,
    );
    assert.equal(
      (
        await productionBase.query(
          "SELECT admin_access($1,'admin@example.invalid',$2) allowed",
          [ADMIN, SESSION],
        )
      ).rows[0].allowed,
      true,
    );
    assert.equal(
      (
        await productionBase.query(
          "SELECT private.verified_admin_identity($1,'other@example.invalid') allowed",
          [ADMIN],
        )
      ).rows[0].allowed,
      false,
    );
    await productionBase.exec("RESET ROLE");
    for (const role of ["anon", "authenticated"]) {
      await productionBase.exec("SET ROLE " + role);
      await assert.rejects(
        () =>
          productionBase.query(
            "SELECT private.verified_admin_identity($1,'admin@example.invalid')",
            [ADMIN],
          ),
        /permission denied/,
      );
      await productionBase.exec("RESET ROLE");
    }
  } finally {
    await productionBase.close();
  }
});
test("privacy RPCs support absent and explicitly installed legacy preregistrations", async () => {
  for (const optionalPreregistrations of [false, true]) {
    const privacyDb = await freshAdminDb({ optionalPreregistrations });
    try {
      await privacyDb.query(
        "INSERT INTO launch_signups(id,email,consent) VALUES('99999999-1111-4111-8111-111111111111','optional@example.invalid',true)",
      );
      if (optionalPreregistrations)
        await privacyDb.query(
          "INSERT INTO preregistrations(email,email_normalized,consent_version,consent_text,confirm_token_hash) VALUES('optional@example.invalid','optional@example.invalid','synthetic-v1','Syntetický souhlas','never_export_this_hash')",
        );
      await privacyDb.exec("SET ROLE service_role");
      const data = (
        await privacyDb.query(
          "SELECT admin_person('optional@example.invalid') result",
        )
      ).rows[0].result;
      assert.equal(data.signups.length, 1);
      assert.equal(
        data.preregistrations.length,
        optionalPreregistrations ? 1 : 0,
      );
      assert.ok(!JSON.stringify(data).includes("never_export_this_hash"));
      await privacyDb.query(
        "SELECT admin_erase('optional@example.invalid',$1,$2,'admin@example.invalid',true)",
        ["f".repeat(64), ADMIN],
      );
      await privacyDb.query(
        "SELECT admin_erase('optional@example.invalid',$1,$2,'admin@example.invalid',false)",
        ["f".repeat(64), ADMIN],
      );
      assert.equal(
        (
          await privacyDb.query(
            "SELECT count(*)::int n FROM launch_signups WHERE email='optional@example.invalid'",
          )
        ).rows[0].n,
        0,
      );
      if (optionalPreregistrations)
        assert.equal(
          (
            await privacyDb.query(
              "SELECT count(*)::int n FROM preregistrations",
            )
          ).rows[0].n,
          0,
        );
      const after = (
        await privacyDb.query(
          "SELECT admin_person('optional@example.invalid') result",
        )
      ).rows[0].result;
      assert.deepEqual(after.records, []);
      assert.deepEqual(after.signups, []);
      assert.deepEqual(after.preregistrations, []);
      await privacyDb.exec("RESET ROLE");
    } finally {
      await privacyDb.close();
    }
  }
});
