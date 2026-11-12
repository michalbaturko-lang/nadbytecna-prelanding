# Microsoft Inbox reliability — 12 November 2026

Graph delta reads previously timed out after 10 seconds; original MIME after 20 seconds. Production logs confirmed `mail_sync_failed / read / timeout`. Original jobs stopped automatically after three failures.

The fix covers fetch and full-body consumption, retries read-only GETs twice with bounded delay, and defers long Retry-After delays to the durable queue. Delta attempts allow 30 seconds; MIME attempts 45 seconds. Sync hosting is 300 seconds. Archive jobs have a five-minute lease and reserve 270 seconds before starting a job.

Temporary timeout/network/HTTP/storage/connection failures remain pending with capped exponential backoff. Interrupted leases recover. Permanent missing/oversized messages remain visible as failures; erased/blocked sources are never revived. The migration preserves the existing RPC permissions and data-erasure guards.

Admin controls under E-mails → Nastavení schránky → Kontrola načítání a ukládání can compare immutable Inbox IDs with active local copies and read back every archived original to verify size and SHA-256. The interface returns aggregate results only. The production manual check found 271 Inbox messages matching all 271 active local copies; four additional copies were retained after leaving the Inbox. All 275 originals were loaded and hash-verified: zero failures and zero pending originals.

Validation: 95 focused transport, API, sync, archival and database tests passed. Security advisors unchanged: two pre-existing warnings. Migration applied atomically with history recorded. AI and mailbox write permissions were not enabled.

These counts are a dated verification, not a guarantee about future arrivals. Minute cron polling, persisted cursor commits and durable retries continue independently of an open browser.
