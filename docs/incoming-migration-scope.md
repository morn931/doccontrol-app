# Scope — migrate CoreDocs off Power Automate (full flow inventory)

_Status: revised 2026-08-19 from the actual Azure export (`rg-vendor-approvals-prod` ARM
template, 48 Logic Apps). Owners: Morné + Liezl. This supersedes the first draft, which
started at `la-intake-core` and missed the per-vendor "small flows" entirely._

## The whole picture (from the real definitions)

Everything lives in **`rg-vendor-approvals-prod`** (South Africa North). 48 Logic Apps + the
AI resources they use: **`PPEOPENAI`** (Azure OpenAI, gpt-4o-mini), **`di-vendor-approvals`**
(Document Intelligence / OCR), plus SharePoint/Office365 API connections.

**The single bridge to the live app:** only **`la-intake-core-sa`** calls
`doccontrol-app.vercel.app/api/intake/webhook`. Everything else is either upstream of it,
a SharePoint-list side-process, or a different module.

## A. INCOMING — the live intake chain (this is the real migration)

### A1. The "small flows" — 16 per-vendor triggers
`E101, E102, E103, E113_Bulk_Fuel_Tanks, E121, E122, E123, E511B_DistributionTransformers,
E516B_33kV_11kV_Mining_Substation, E516B_33kV_Main_Consumer_Substation, E516B_ERooms,
E518B_PCS_Hardware, K108, K110, K125, K137` (and `ICTS`).

Each is tiny and identical in shape:
- **Trigger:** *When a file is created* in **that vendor's own "From" drop-off library** (polling, 1–10 min).
- **Actions (3):** `Filter_PDFs` → `Select_Files` → `If_Has_PDFs` → **HTTP POST to `la-intake-core-sa`** (passing the file link(s) + vendor key).

So they are **pure per-vendor watchers** that forward new PDFs to the core. Nothing else.
`la_vendor_intake` is a **disabled** generic version (superseded by these per-vendor ones).

→ **Replacement:** one **cron poller** (scope item T1) replaces all 16+ at once — it lists each
active `vendor_sites.dropoff_library` via Graph, diffs new files, and hands them to the in-app
pipeline. The vendor key each small flow injects is already the package on the `vendor_sites` row.

### A2. `la-intake-core-sa` — the core (31 actions, HTTP-triggered)
Does, in order:
1. Fetch the file bytes (by id / path).
2. **OCR** via Document Intelligence (`HTTP - Analyze` + poll `Until` complete).
3. **AI classify** via Azure OpenAI gpt-4o-mini (`HTTP - AOAI Chat`) → parses **DocName /
   Discipline / DocumentType / Topic / Summary**.
4. **Copy** the file into the DocumentControl package bucket (`Create_file_return`).
5. Set SharePoint metadata (AIText, DocUniqueId, …).
6. Repeat copy/metadata for each additional file in the batch.
7. **Create the Approver Picks list row** (`Create_item`).
8. **Email the controller.**
9. **POST to the app** (`/api/intake/webhook`, MODE A) — the app then writes the DB records.

→ **Replacement:** this is the "MODE B" the app must own end-to-end. The heavy new build is
**steps 2–3 (OCR + AI classify)** — scope item **T4**. Steps 4–6 (copy/metadata) already exist
(`copyFileToDocControl`); step 7 (Approver Picks) is **retired**, not replaced; step 9 becomes
the app doing the DB write directly instead of receiving its own webhook.

## B. REVIEW ROUTING — appears already replaced by the app's native review engine
- `la_build_route_from_picks` — on a new file in the bucket: creates **DocumentApprovalList**
  rows (one per reviewer), sets `OverallStatus = "In Review"`, emails the first reviewer.
  **(This — with the choice column's "Awaiting Routing" default — is the origin of the
  "Awaiting Routing" status, NOT the return flow.)**
- `la_seq_approvals`, `va_sequential_next` **(DISABLED)**, `va_sequential_notify`,
  `LA_InsertAdditionalReviewers`, `va_intake_reject_batch` — the sequential-reviewer workflow.

→ The app now owns reviews natively (`review_tasks` + the review UI), and `va_sequential_next`
is already **Disabled** — strong evidence this whole group is legacy. **VERIFY they're all
inactive, then retire.** (Low risk; not on the live app path.)

## C. RETURN TO VENDOR (outgoing) — largely done
- **`la_return_batch_to_vendor`** — **already replaced in-app (our work, 2026-08-19).** Trigger:
  Approver Picks item with `ReturnRequested=true`; per-vendor library cascade → `Apply_to_each_Doc`
  (get file content → **create file in the return library**) → set `ReturnRequested=false,
  ReturnComplete=true`. **Confirmed: it does NOT set `OverallStatus`** — so PA-returned files are
  blank, which is why clearing our copies' "Awaiting Routing" to blank was the correct match.
- `la_return_pack`, `la_return_reviewed_core` (HTTP-triggered) — other return helpers. **VERIFY**
  whether the in-app return already covers these or they still do something (e.g. a transmittal pack).

## D. MARKUP SUMMARY — appears replaced
- `la_run_batch_markup_summary` (triggers) → `la_summarise_markups` (HTTP). The app captures
  mark-ups natively (`document_markups`). **VERIFY, then retire.**

## E. DOCUMENT REGISTER / MDDR — VERIFY before touching (some may be live)
- `DocumentIndex` (weekly), `IndexMirror`, `DocuemntNumberBreakdown`, `FileLink_FOR_MDDR`,
  `MDDR_Populate` (daily 04:00), `MDDREXCELIMPORT` (manual). These index documents / populate the
  MDDR. The app has its own MDDR (`mddr_entries`) and doc-search, but these PA flows may still feed
  SharePoint lists the app reads. **Map each against the app's current MDDR/search ingestion before
  retiring — this is the group most likely to still be doing real work.**

## F. NOT CoreDocs — other modules (out of scope for this migration)
On Power Automate but belonging to other systems; note they exist but don't touch them here:
- **CoreTime designations:** `DesignationPopulation`, `Designation_Fill_Back_up`,
  `Designation_Update`, `Designation_UpdateRev1`.
- **CoreTime time entries:** `TimeEntryDaily`, `la_timeentries_unpivot`.
- **Finance / expense:** `Expense_Scanner`, `la_expense_receipt_ai` (+ `receipt-ai1` Doc Intelligence).
- **Reports:** `PMC_Share`.

## Revised migration plan

The outgoing side (C) is done. To finish CoreDocs' independence:

1. **T1 — Cron poller** replaces **all 16 small flows** at once (list each `vendor_sites`
   dropoff library, diff new files, feed the pipeline). _(S–M)_
2. **T2 — Ingest ledger** (idempotent; never ingest a file twice). _(S)_
3. **T3 — Grouping rule** (which files form one batch). _(M — decision)_
4. **T4 — OCR + AI classify in-app** — replicate `la-intake-core-sa` steps 2–3 (reuse Document
   Intelligence + Azure OpenAI `PPEOPENAI`; these AI resources stay). **Biggest piece.** _(M–L)_
5. **T5 — Wire MODE B** end-to-end (poller → copy → OCR/AI → group → DB → email); drop the
   Approver Picks row + the self-webhook. _(M)_
6. **T6 — Shadow week:** run the poller alongside PA, compare, then disable the 16 small flows +
   `la-intake-core-sa` once parity holds. **Do not disable before parity.** _(S, gated)_
7. **T7 — Retire the legacy side-flows** (B, D, and any of C not covered) after confirming they're
   inactive. _(S)_
8. **T8 — Audit group E (register/MDDR)** against the app's current ingestion **before** retiring
   anything there. _(M — investigation)_

## Decisions / confirmations needed from Morné + Liezl
1. **Trigger:** cron poll (recommended) vs Graph change-notifications.
2. **Grouping:** how the small flows / core currently decide "these files are one batch" (by drop
   window? all files in one trigger?).
3. **Confirm legacy:** groups **B** (review routing) and **D** (markup) — are these fully off, or
   still doing anything?
4. **Group E (register/MDDR):** the one that needs a real audit — is any of it still feeding the
   live app's MDDR / doc-search?
5. **ICTS + the three E516B sub-package flows** — confirm each maps to a `vendor_sites` row so the
   poller covers them.

---

### Already shipped (outgoing / return-to-vendor, 2026-08-19)
- `copyFileToVendorReturn()` (Graph cross-site copy, delete-stale-then-copy, clears the vendor
  list routing status) + `returnBatchFilesToVendor()`; `generate-transmittal` returns files in-app
  (replacing the `la_return_batch_to_vendor` PA flow); `/api/batches/[id]/return` for retries/remediation.
