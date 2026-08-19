# Scope — migrate CoreDocs **incoming batches** off Power Automate

_Status: proposed (2026-08-19). Owners: Morné + Liezl. Prereq context: the **outgoing**
(return-to-vendor) flow was already migrated in-app — see "Companion change" at the bottom._

## Why

CoreDocs has moved almost the whole document lifecycle into the app. Two Power Automate /
Logic App flows remain: **incoming** (vendor uploads → batch) and **outgoing** (return to
vendor). Outgoing is now done in-app via Graph. This doc scopes retiring the **last** PA
flow, incoming, for the same reasons:

- **Opacity / silent failure.** PA flows aren't in the repo, aren't in our logs, run under
  an account, and can throttle or stop with no signal. The return bug we just fixed (new-app
  batches silently skipped) was a direct symptom of app-logic depending on an invisible PA
  flow. Incoming carries the same class of risk.
- **Consistency & ownership.** Everything else is in the app. One remaining out-of-band flow
  is a maintenance and knowledge liability.
- The app **already** has the Graph plumbing this needs (app-only token, `copyFileToDocControl`,
  filename parsing, DB writes, controller email).

## Current incoming flow (as-is)

The agent **`la-intake-core`** (Power Automate / Logic App) is triggered when a vendor drops a
file into their SharePoint drop-off library (`FROM PSI`, `From ABB`, `FROM VENDOR`, …). It then:

1. **Copies** the file into the DocumentControl package bucket.
2. Runs **OCR + AI classification** (DocName / discipline / document type / topic).
3. Creates the **Approver Picks** SharePoint list row.
4. **Emails** the controller.
5. **POSTs an enriched payload** to `POST /api/intake/webhook` (MODE A), which just writes the
   DB records (`batches`, `document_versions`, …). The app deliberately does *no* copy/OCR/AI in
   MODE A — the agent already did it.

The webhook already documents a **MODE B** ("webhook handles everything … used when
la-intake-core is fully retired") — but MODE B still needs a **trigger** and needs the app to
own copy + OCR + AI + grouping. That trigger + those steps are exactly what PA does today and
what this migration must replace.

## Target flow (to-be) — app owns intake end-to-end

Two independent pieces: **the trigger** (detect new files) and **the pipeline** (what to do
with them). The pipeline is mostly built; the trigger is the new part.

### 1. Trigger — how the app learns a new file arrived

| Option | How | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **A. Cron poll** | A Vercel cron every N minutes lists each vendor's drop-off library via Graph, diffs against what's already ingested (by driveItem id / etag), and processes new items. | Simple; reuses existing cron infra; dead-reliable; no subscription lifecycle. | Latency = poll interval (minutes); lists N libraries each run. | **Preferred for v1** — least moving parts, matches how we already run crons. |
| **B. Graph change-notifications** | Subscribe to each drop-off library's drive; Graph POSTs to our endpoint on change. | Near-real-time. | Subscriptions expire ~3 days (must auto-renew); validation handshake; client secret; more surface to keep alive. | Optional later, only if minutes-latency proves too slow. |

`vendor_sites` already lists every package's site + drop-off library (`dropoff_library`, e.g.
`FROM PSI`), so the poller has its worklist with no new config.

### 2. Pipeline — what happens per new file (most of this already exists)

1. **Copy** vendor file → DocumentControl package bucket — `copyFileToDocControl` (exists).
2. **Parse** the filename → document number / revision — `parseDocumentFileName` (exists).
3. **Classify** (DocName / discipline / doc type / topic) — the OCR + AI step PA does today.
   This is the **one genuinely new build**: replicate `la-intake-core`'s classification in-app.
   Note CoreDocs intake classification is the single AI step the platform runs on **Azure**
   (see the "Coreflow AI inventory" note) — reuse that, don't re-decide the model here.
4. **Group** files dropped together into one batch (PA's grouping heuristic — by drop time /
   upload session — must be reproduced; needs a small design decision on the window).
5. **Write DB records** (`batches`, `document_versions`) — MODE B path already scaffolded.
6. **Email** the controller — existing templates.
7. Retire the **Approver Picks** row creation (no longer needed once PA is gone).

## Work breakdown

- [ ] **T1 — Poller** (`/api/cron/intake-poll`): list each active `vendor_sites` drop-off library,
      diff new driveItems against an ingest-ledger (id/etag), hand new files to the pipeline. _(S–M)_
- [ ] **T2 — Ingest ledger**: a small table (or reuse an existing marker) so a file is never
      ingested twice; survives re-runs. _(S)_
- [ ] **T3 — Grouping**: decide + implement the "these files are one batch" rule (upload-session
      or a short arrival window). Confirm the exact rule PA uses first. _(M — needs a decision)_
- [ ] **T4 — Classification**: in-app OCR + AI classify (Azure), matching PA's output fields.
      The biggest piece; validate against a sample of recent real intakes. _(M–L)_
- [ ] **T5 — Wire MODE B** end-to-end (copy → parse → classify → group → DB → email) and make
      MODE A a thin legacy fallback. _(M)_
- [ ] **T6 — Cutover**: run the poller in **shadow** (detect + log, no writes) alongside PA for a
      week; compare what each produces; then flip PA off (disable `la-intake-core`) once parity is
      proven. _(S, but gated on a clean parity week)_
- [ ] **T7 — Decommission**: remove Approver Picks creation; archive the PA flow. _(S)_

## Risks & mitigations

- **Missed or double intake.** → The ingest-ledger (T2) makes ingestion idempotent; the shadow
  week (T6) proves the poller sees everything PA sees before we trust it.
- **Classification quality regresses vs PA.** → T4 validated against a labelled sample of recent
  real intakes before cutover; keep MODE A as a fallback during the shadow week.
- **Grouping differs from PA** (files split across batches or wrongly merged). → Nail the exact PA
  rule first (T3); compare grouping in the shadow week.
- **Latency** (cron interval). → Start at a few minutes; only move to change-notifications (Option
  B) if that proves too slow in practice.

## Effort (rough) & sequencing

Roughly **1–2 focused weeks**, most of it in **T4 (classification)** and the **T6 shadow/parity
week**. Suggested order: T1+T2 (poller + ledger) → T3 (grouping decision) → T4 (classification) →
T5 (wire MODE B) → **T6 shadow week** → T7 (flip PA off). Do **not** disable `la-intake-core`
until the shadow week shows parity.

## Decisions needed from Morné / Liezl

1. **Trigger:** cron poll (recommended) vs Graph change-notifications.
2. **Poll interval** if cron (e.g. every 3–5 min).
3. **Classification:** confirm we reuse the existing Azure intake-classification approach.
4. **Owner + slot:** this is Liezl's area — who drives it, and when.

---

### Companion change already shipped (outgoing / return-to-vendor)

The return flow is **already migrated in-app** (this fixed the PSI "documents not uploaded"
issue):

- `lib/services/graph.ts` → `copyFileToVendorReturn()` — cross-site Graph copy into the vendor's
  return library.
- `lib/services/return-to-vendor.ts` → `returnBatchFilesToVendor()` — copies a batch's reviewed
  documents to the vendor library and stamps `returned_at` / `returned_file_url`.
- `app/api/batches/[id]/generate-transmittal/route.ts` — now returns files in-app (replaced the
  `setApproverPicksReturnRequested` PA trigger); marks the batch `returned_to_vendor` on success.
- `app/api/batches/[id]/return/route.ts` — Doc-Control-gated re-run, to retry a partial return or
  remediate the 11 legacy new-app batches whose files were never delivered.

So the PA **outgoing** flow is effectively retired (the app no longer sets `ReturnRequested`);
this doc covers retiring the PA **incoming** flow, the last one.
