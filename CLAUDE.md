# DocControl App — Project Context for Claude

## What This Is
A modern web-based document approval & control system for PPE Tech (PPE Technologies), replacing an existing SharePoint / Power Apps / Logic Apps system. The new app runs **in parallel** with the old system — both can be used simultaneously. Nothing in the old system has been removed or overridden.

**Live URL:** https://doccontrol-app.vercel.app  
**Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres + **pgvector**), Vercel, Microsoft Graph API, Azure Document Intelligence, Azure OpenAI (classification + **embeddings**), **recharts** (reporting), **xlsx** (register parsing)  
**Repo:** `C:\Users\mornec\Claude\Projects\Document management (1)\doccontrol-app`  
**Co-owners (equal, full authority):** Morné Cronjé — mornec@ppetech.co.za — **and** Liezl Cronjé — liezlc@ppetech.co.za. Both hold full repo write/merge rights, full Supabase access, and admin in the apps. **Either may review and merge their own PRs and run migrations/scripts — neither needs the other's sign-off for routine work; do NOT route actions through "ask Morné" / "ask Liezl".**

---

## Core Business Process (What the App Does)

1. Vendors upload documents to their SharePoint "FROM VENDOR" drop-off libraries
2. Intake automation detects uploads, copies to central DocumentControl SharePoint site, runs AI classification
3. Document controller receives email, opens batch in new web app, picks reviewers
4. Sequential reviewer workflow — each reviewer gets email, opens review form, marks up PDF, selects outcome code, adds comments
5. All reviews complete → system determines worst-case outcome code, generates transmittal PDF, emails vendor
6. Existing Logic App (`la-return-batch-to-vendor`) copies reviewed documents back to vendor's "TO VENDOR" SharePoint library

---

## Key Infrastructure

### Supabase Project
- URL: `https://tjzeahdimbekuizegsky.supabase.co`
- Key tables: `batches`, `document_versions`, `review_tasks`, `users`, `vendors`, `packages`, `vendor_sites`, `transmittals`, `audit_events`

### SharePoint (Microsoft 365 tenant: ppetechcoza)
- Central site: `https://ppetechcoza.sharepoint.com/sites/DocumentControl`
- **Approver Picks list ID:** `b5978f12-495c-49b6-bff4-3392a8d2a681` (one row per batch, triggers return-to-vendor flow)
- **Document Approval List ID:** `9711d630-daee-426e-b621-d941fc18c01f` (one row per doc per reviewer, write-back from new app)
- **Document Index list ID:** `e348e9d5-3fb3-45b2-951d-7b299826ce0d` (display "Document Index", URL slug "Mater Site Document Index") — site-wide master of every file, with AISummary/AIKeywords + file URLs; source for MDDR sectors + `file_link`.

### Azure Resources (rg-vendor-approvals-prod, South Africa North)
- Azure Document Intelligence: OCR/text extraction
- Azure OpenAI: AI document classification (Discipline, DocumentType, Topic, Summary)
- PDF annotation extraction Azure Function: `func-doccontrol-pdf-annotations-fdfrfsccahf4cpdj`
- Logic App: `la-return-batch-to-vendor` — polls Approver Picks every 5 min for `ReturnRequested=true`

### Vendor Package Sites
All packages mapped in `vendor_sites` Supabase table AND in `supabase/migrations/20260608_seed_vendor_sites.sql`. Key packages: E101, E102, E103, E121, E122, E123, K108, K110, K125, K137, ICTS. Each has a "FROM VENDOR" drop-off library and "TO VENDOR" return library on their SharePoint site.

---

## Outcome Codes
`A1` Approved | `D1` Approved with Comments | `B1` Approved with Comments - Resubmit | `B2` Approved with Minor Comments | `C1` Data Incomplete - Hold Work - Resubmit | `Q1` Rejected | `V1` Void | `S1` Superseded  
Worst-case severity order: A1 > D1 > B1 > B2 > C1 > Q1 > V1 > S1

---

## What Has Been Built & Is Working

### Transmittal Generation (`/api/batches/[id]/generate-transmittal`)
- **GET**: builds transmittal preview (no PDF, no email) — used by the "View/Send Transmittal" modal
- **POST**: generates PDF with PDFKit, sends email via Microsoft Graph, stores transmittal record, triggers return-to-vendor
- PDF is professionally formatted A4 — title block, info table, document summary, per-doc reviewer outcomes, acknowledgement page, legend
- Email trim fix: trailing `\n` on stored emails was causing Graph API rejection — now trimmed

### PDFKit Fix
- `pdfkit` must be in `serverExternalPackages` in `next.config.ts` — prevents webpack from bundling it (which broke class constructors)
- Uses standard PDF fonts only (no filesystem access) — works in Vercel serverless

### Return-to-Vendor Integration
The new app triggers the existing Logic App by setting `ReturnRequested = true` on the Approver Picks SharePoint list item after transmittal is sent. Implementation in `lib/services/sharepoint-lists.ts` → `setApproverPicksReturnRequested()`.

**Key implementation detail:** The Approver Picks list has 300+ items. Graph API pages at 200/request. Pagination uses `@odata.nextLink` which is an **absolute URL** — must use raw `fetch` with auth token, NOT `graphFetch()` (which prepends the base URL). See `graphFetchAbsolute()` in `sharepoint-lists.ts`.

**Source site URL** is looked up from `vendor_sites` table by `package_id` to get the clean site root (e.g. `https://.../sites/K108-BatteryEnergyStorageSystem`) so the Logic App routes return correctly.

**The Logic App's False branch** (no docs returned): happens when Document Approval List has no rows with `ReviewComplete=true` AND `ApprovalStatus=Approved/Rejected` for the batch. This occurred on the K108 test batch due to test iterations — will work correctly on clean production batches.

### Debug Endpoint (temporary, remove when confirmed working)
`GET /api/batches/[id]/debug-return` — shows Supabase batch_guid vs SharePoint Approver Picks item, confirms match and ReturnRequested value.

### SharePoint Write-back (lib/services/sharepoint-lists.ts)
- `createApprovalListRow()` — creates Document Approval List row when review starts
- `markApprovalListRowComplete()` — updates row when reviewer submits (sets ReviewComplete=true, ApprovalStatus=Approved)
- `markApprovalListRowSent()` — marks row when email sent to reviewer
- `setApproverPicksReturnRequested()` — sets ReturnRequested=true on Approver Picks item after transmittal

### Microsoft Graph Service (lib/services/graph.ts)
- App-only auth (client credentials) — token cached in memory
- `graphFetch(relativePath)` — prepends `https://graph.microsoft.com/v1.0`
- `graphFetchAbsolute(absoluteUrl)` — for pagination nextLinks (defined locally in sharepoint-lists.ts)
- `sendEmail()` — sends via `/users/{fromUser}/sendMail`
- `copyFileToDocControl()` — copies vendor files to central DocumentControl library

---

## SharePoint Sync (direct + daily) — Import & Sync page

Three ways to bring SharePoint review data into Supabase, all sharing one importer
(`lib/import/process.ts` → `processImport`; maps the Approver Picks + Document Approval
list columns to `batches` / `document_versions` / `review_tasks`):
- **CSV upload** (original) — `POST /api/admin/import`.
- **Manual "Sync now"** — `POST /api/admin/sync-sharepoint` reads both lists live via Graph
  (`readApproverPicks` / `readApprovalList` in `sharepoint-lists.ts`, paginated, booleans → 'True'/'False')
  and runs the importer. Modes: full / dry_run.
- **Daily automatic** — Vercel Cron `GET /api/cron/sharepoint-sync` at 02:00 UTC (see `vercel.json` → `crons`).
  Shared engine: `lib/import/sharepoint-sync.ts` → `syncFromSharePoint`.

**Setup:** set env `CRON_SECRET` (Vercel sends it as `Authorization: Bearer …`; the cron route rejects
mismatches). NB `vercel.json` has `git.deploymentEnabled.main = false` — confirm how prod deploys
(crons only register on a production deploy).

## MDDR — Master Document & Drawing Register

A combined master of every deliverable across all registers, with progress tracked
against the agreed Siemens Rules of Credit. Menu: **MDDR** (`/mddr`).

### Registers it ingests
- **SDDR** — Supplier Document & Drawing Register (one per vendor per package; data in
  the `Register` sheet, header on **row 2**; vendor variants e.g. ABB add extra cols).
- **CDDL** — Contractor's Document & Deliverables List (PPE's own docs; `CDDL` sheet,
  header **row 1**).
- **MDDR/GMDR** — the master from RDMC (multi-sheet, one per area; header on **row 10**;
  includes unawarded scope rows where vendor = "To be Appointed" / doc number blank).

### How it works
- **Parsing/mapping**: `lib/mddr/mapping.ts` auto-detects the header row, walks **all**
  sheets, maps every real header to a canonical field, and preserves **every original
  column** verbatim in `mddr_entries.raw` (JSONB) so any header stays filterable/reportable.
- **One master per document**: rows merge by `normalized_document_number` (a unique
  partial index). Awarded docs merge across registers (SDDR/CDDL own accurate dates/status,
  the GMDR fills gaps); unawarded scope rows are flagged `is_awarded = false`.
- **Doc-number normalisation** (`normalizeDocNumber` in `mapping.ts`): upper-cases, strips
  revision/sheet/extension suffixes, AND reconciles the discipline/type delimiter difference
  between registers — the master GMDR splits them (`…-E-GAD-…`) while vendor SDDRs and the
  live document filenames fuse them (`…-EGAD-…`). It collapses to the fused form so the same
  document merges into ONE master row. Also matches package codes with a trailing letter
  (e.g. `E511B`, `E516B`).
- **Rules of Credit** (`lib/mddr/rules-of-credit.ts`, agreed with Siemens 4 Jun 2026):
  **25%** first submission → **75%** reviewed w/ comments/proceed (B1/B2/D1, not C1/Q1) →
  **85%** A1 accepted → **100%** numeric Rev 0+ IFC/IFD. Credits are constants, easy to retune.
- **Status carry-over** (`lib/mddr/sync.ts`): matches each master doc number to the live
  `document_versions` (by parsed filename) + worst-case `review_tasks` outcome, then applies
  the Rules of Credit. (`documents` table is empty; matching goes via `document_versions`.)
  NB: the awarded-entries pagination MUST `.order('id')` — offset paging without a stable
  order while updating rows silently skips rows and undercounts matches.
- **Shared libs** `lib/mddr/import.ts` + `sync.ts` are used by BOTH the API routes and the
  CLI scripts, so there is no duplicated logic.

### MDDR page UI (`app/(app)/mddr/page.tsx`)
- Filters: **Package** chips → repopulate **Vendor** chips for that package → **Source**
  (SDDR/CDDL/MDDR) → **Show** (Awarded docs / Unawarded scope, default awarded so the ~87k
  scope rows don't swamp the view). Plus a broad server search box (top-right).
- **Doc Number quick-filter** (top-left of the table): client-side, narrows rows as you type.
  The page loads the full result set (`limit=10000`; list API cap raised to 20000) so it can
  find any document, not just the first page.
- **Frozen columns** through **Title** (`position: sticky` with computed left offsets) so the
  doc number/title stay visible when scrolling right; table is height-bounded so the
  horizontal scrollbar stays in view while scrolling rows.
- **Excel-style header menus** (`ColumnMenu`): click any column header to Sort A→Z / Z→A, type-ahead
  search (contains, narrows the table + the value list), and tick distinct values to filter. All
  client-side over the loaded rows; the value list respects other columns' active filters; a funnel
  icon marks filtered columns and "N column filters · Clear" resets them. CSV export honours filters.
- Column picker, CSV export, Sync Progress, Upload Register (merge/override) buttons.

### Bulk load / sync (service-role, bypasses auth-gated HTTP routes)
```
npx tsx scripts/import-direct.ts            # import all Registers/*.xlsx (SDDR/CDDL first, GMDR last)
npx tsx scripts/import-direct.ts --wipe      # clear master first (batched delete), then re-import
npx tsx scripts/import-direct.ts K137       # only files matching a substring
npx tsx scripts/sync-direct.ts              # carry live review status → progress (all packages)
npx tsx scripts/sync-direct.ts K137         # one package
```
Note: a single delete of the whole ~95k-row table exceeds the statement timeout, so `--wipe`
deletes in id-batches.
The UI "Upload Register" (merge/override) and "Sync Progress" buttons do the same via
`/api/mddr/upload` and `/api/mddr/sync`.

### Schema (`supabase/migrations/004_mddr_schema.sql`, idempotent)
- `mddr_registers` — one row per uploaded file. `mddr_entries` — the master rows.
- Key columns: `normalized_document_number` (merge key, unique partial index),
  `is_awarded`, `source_types[]`, `raw` JSONB, `progress_percent` / `progress_milestone` /
  `progress_source`, `activity_id` (for the future P6 export), `linked_version_id`.
- **Depends on the base tables** (`vendors`, `users`, `documents`, `document_versions`) —
  run it in the DocControl project `tjzeahdimbekuizegsky`, NOT CoreTime.

### Known gaps / next
- **Activity IDs**: 4,086 K124 (CDDL) docs now carry Activity IDs (loaded from the updated CDDL,
  515 activities) → P6 export works for K124. Vendor packages populate as their registers add them.

## Reporting (menu: **Reporting**, `/reporting`)

Reports computed live off the MDDR. Charts use **recharts**.

- **Progress Dashboard** (`/reporting/dashboard`) — 4 charts: Planned-vs-Actual **S-curve**
  (cumulative %, over docs with a planned date), Planned vs Actual by package (bars), Document
  Maturity by Rules-of-Credit milestone (donut), and Schedule Variance by package (diverging bars).
  MDDR-style filters (package/vendor/source/awarded) tailor all charts and flow into each chart's
  heading; KPI tiles + on-chart data labels make it print/screenshot-friendly. API
  `app/api/reporting/dashboard` (accepts the same filter params).

Plus these detail reports (all live off the MDDR):
- **Engineering Tracker** (`/reporting/engineering-tracker`) — by package; EVM hours/progress.
- **Package Progress Summary** (`/reporting/package-progress`) — by package; doc counts & progress.
- **P6 Activity-ID Progress Export** (`/reporting/p6-export`) — rolls document progress up to one
  Physical % Complete per P6 Activity ID; P6-ready CSV (Activity ID + % Complete). `lib/reporting/p6-export.ts`.
  Activity IDs live on `mddr_entries.activity_id` (already mapped from the CDDL "Activity ID" column;
  4,086 K124 docs loaded across 515 activities — vendor packages populate as their registers add them).
- **PPE Phase 1 Engineering Deliverables** (`/reporting/phase1-deliverables`) — by **WBS code**,
  **PPE CDDL only**; 3-milestone completion (Rev A / Rev 0 / Approved, 1/3 each) derived from each
  doc's Aconex status (IFR/IFD/IFC/IFU) + Rev A/Rev 0 transmittal dates + revision; placeholders
  ("RES - Reserved Placeholder" / "No Placeholder Yet") = 0%. `lib/reporting/phase1-wbs.ts`.

`lib/reporting/package-progress.ts` → `aggregatePackages(db, periodEnd)` is the single
per-package aggregator (active/approved/matched docs, missing due dates, actual% = avg
Rules-of-Credit progress, planned% = docs due ≤ "as of", variance). It backs the first two reports.

- **Config** `lib/reporting/eng-tracker-config.ts` — the static budget hours per package
  + Links inputs (planned staffed hours EOP = 16050), captured from the workbook. Edit here
  when the budget basis changes.
- **Engine** `lib/reporting/engineering-tracker.ts` — `buildTracker(stats)` produces all
  columns. `currentBudget` = staffed-hours × (pkg budget / Σ budget) (K124 = control line,
  taken as-is); `earned = currentBudget × actual%`; subtotals are hours-weighted. Reproduces
  the sheet exactly (K125 F=2138, E102 F=1063, Eng subtotal F=63,675).
- **API** `app/api/reporting/engineering-tracker/route.ts` — aggregates awarded MDDR rows per
  package: actual% = avg Rules-of-Credit progress; plan-to-date% = docs with planned date ≤
  "as of"; approved = A1 count.
- **Ratio corrections vs the spreadsheet** (the sheet's were wrong): "% of Proj" divided by an
  empty cell → always 0 (fixed to budget-hours / grand total); "% of Discpl" used doc-COUNT
  share → switched to budget-HOUR share for consistency (UI toggle keeps "docs" available).
- Note: the workbook's GRAND TOTAL hours were inflated by a stray K-001 = 141,865 entry; the
  contracts here use their real budget (0).

## Key Files

```
app/(app)/
  batches/ transmittals/ reviews/        — core review workflow
  documents/                             — DOCUMENT SEARCH (MDDR-backed: filters, scope toggle,
                                           Doc#/Title + Smart search, Open + revisions drawer)
  mddr/page.tsx                          — MDDR master table (filters, Excel header menus, upload)
  reporting/                             — landing + dashboard, engineering-tracker, package-progress,
                                           phase1-deliverables, p6-export
  admin/import/                          — Import & Sync (CSV + direct SharePoint sync)
  admin/vendors/                         — Vendors & Packages (awarded vendor per package)
app/api/
  batches/[id]/ reviews/[id]/ intake/webhook/   — review workflow + intake
  admin/import/                          — CSV import (POST)
  admin/sync-sharepoint/                 — manual direct Graph sync (POST)
  cron/sharepoint-sync/                  — daily Vercel cron (GET, CRON_SECRET)
  mddr/        route.ts                  — list (filters, sector, exclude_index, has_file, paginated)
  mddr/meta/ upload/ sync/ semantic/ revisions/ open/   — MDDR APIs
  reporting/dashboard|engineering-tracker|package-progress|phase1-deliverables|p6-export/
lib/
  services/  graph.ts · sharepoint-lists.ts (read/write + list readers) · document-intelligence.ts
             · openai.ts · embeddings.ts (Azure embeddings) · sp-resolve.ts (live link resolver)
             · email-templates.ts
  mddr/      mapping.ts · rules-of-credit.ts · import.ts · sync.ts
  import/    process.ts (shared importer) · sharepoint-sync.ts
  reporting/ package-progress.ts · engineering-tracker.ts · eng-tracker-config.ts · phase1-wbs.ts · p6-export.ts
  package-vendors.ts                     — package → awarded vendor map
  utils/     outcome-codes.ts · document-number-parser.ts
scripts/     import-direct.ts · sync-direct.ts · embed-mddr.ts   (tsx)
             import-docindex.py · backfill-filelinks.py · validate-filelinks.py   (python, Graph)
supabase/migrations/  001_initial_schema · 002_search_indexes · 003_rls_policies
             · 20260608_seed_vendor_sites · 004_mddr_schema · 005_mddr_semantic
             · 006_mddr_sectors · 007_match_mddr_filelink
```

---

## Pending / Next Steps

1. Run `scripts/validate-filelinks.py --apply` periodically (repairs stale links, nulls dead ones);
   optionally fold embed + link-refresh into the daily cron so sectors/links stay current automatically.
2. Optional: full Document-Index revision history (store all index file rows) so the revisions drawer
   covers index-only docs, not just `document_versions`.
3. Optional: normalise vendor-name variants ("PPE Technologies" vs "PPE - Technologies", "Other").
4. **Remove debug endpoint** `app/api/batches/[id]/debug-return/route.ts` once return-to-vendor confirmed.
5. Vendor portal upload interface (vendors still upload to SharePoint today).
6. Engineering Manager override / escalation flow; return-to-vendor `ReturnComplete=true` write-back.

---

## Environment Variables (Vercel + .env.local)
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
MICROSOFT_TENANT_ID
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
SHAREPOINT_DOCUMENTCONTROL_SITE_URL=https://ppetechcoza.sharepoint.com/sites/DocumentControl
CONTROLLER_EMAIL=liezlc@ppetech.co.za
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
AZURE_DOCUMENT_INTELLIGENCE_KEY
AZURE_OPENAI_ENDPOINT
AZURE_OPENAI_API_KEY
AZURE_OPENAI_INTAKE_DEPLOYMENT            # chat model for classification (gpt-4o-mini)
AZURE_OPENAI_REVIEW_SUMMARY_DEPLOYMENT
AZURE_OPENAI_EMBEDDING_DEPLOYMENT         # text-embedding-3-small — semantic search
CRON_SECRET                              # Vercel cron auth (Bearer); set before deploy
PDF_ANNOTATION_FUNCTION_URL
PDF_ANNOTATION_FUNCTION_KEY
INTAKE_WEBHOOK_SECRET
VENDOR_PORTAL_URL
```
Azure OpenAI resource = **`ppeopenai`** (`https://ppeopenai.openai.azure.com`, South Africa North).

---

## How to Resume Work in a New Conversation

1. Open Cowork and connect this folder (`doccontrol-app`) or the `Document management` project folder
2. Say: *"Continue work on the PPE Tech doccontrol app — read CLAUDE.md for full context"*
3. Claude will read this file and be fully up to speed immediately

This file should be updated at the end of each work session with new progress.

## Changelog (most recent first)
- **2026-06-14 — Open links + revisions + scope toggle.**
  Document Search gained a **Scope** toggle — *With documents produced* (default; only docs that
  have a `file_link`) vs *Full MDDR (incl. placeholders)*. Each result has an **Open** button that
  resolves the file's CURRENT SharePoint location live via Graph (`/api/mddr/open` →
  `lib/services/sp-resolve.ts`; falls back to a parent-folder lookup for renames/revision drift —
  fixes the stale "404 NOT FOUND" on Document-Index links). Click a row to expand a **revisions
  drawer** (all revisions, latest tagged, each openable — `/api/mddr/revisions`). `file_link`
  backfilled for register docs (`scripts/backfill-filelinks.py` from Document Index + central_file_url);
  `scripts/validate-filelinks.py` audits/repairs/nulls links (token-refresh safe).
  **Perf fixes:** the list API selects an explicit column list (NEVER the heavy `embedding`/`raw`/
  `ai_text`) and dropped the exact `count` — resolved the slowness + "statement timeout".
- **2026-06-13/14 — Document Index → MDDR sectors (migration 006).**
  The site-wide SharePoint **"Document Index"** (display "Document Index", URL slug
  "Mater Site Document Index", id `e348e9d5-3fb3-45b2-951d-7b299826ce0d`) is the master of every
  file. `scripts/import-docindex.py` imported the balance not in the registers: **22 register
  gap-fills** + **2,926 `source_type='INDEX'` rows** across 5 `sector`s (K038 Early Works · SHERQ/
  Safety · QC · Plans/Procedures · Specs/Datasheets) with `file_link` + `ai_text`. INDEX rows are
  EXCLUDED from the register MDDR page (`exclude_index=1`) and EVM reports, but searchable in
  Document Search via a **Sector** filter.
- **Semantic search (migrations 005 + 007).** pgvector embeddings of each doc's AI summary;
  **Smart search** box in Document Search (`POST /api/mddr/semantic` → `match_mddr` RPC, returns
  `file_link`/`ai_text`/`similarity`). `lib/services/embeddings.ts` (Azure `text-embedding-3-small`,
  1536 dims); `scripts/embed-mddr.ts` backfills (~9,000 awarded + INDEX docs embedded). Env
  `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` required.
- **Document Search overhaul.** Repointed at the MDDR (full register, not just the 790 live docs):
  package/vendor/source/awarded chips + discipline/doc-type/status dropdowns + sector + scope +
  separate **Doc Number** and **Title** searches. **Vendors & Packages** shows the awarded vendor
  per package (`lib/package-vendors.ts`; default "Not awarded yet"; K124 = PPE).
- **SharePoint sync (direct + daily).** Import & Sync page: CSV upload (orig) + "Sync now"
  (full/incremental/dry) + daily Vercel Cron 02:00 UTC. Shared importer `lib/import/process.ts`;
  Graph readers in `sharepoint-lists.ts`. Env `CRON_SECRET`.
- **Reporting menu (recharts).** Progress Dashboard (S-curve + 3 charts), Engineering Tracker (EVM),
  Package Progress Summary, PPE Phase 1 Deliverables (by WBS), P6 Activity-ID export.
- **MDDR module (migration 004).** All registers reconciled to ONE master per doc number; Rules of
  Credit progress (25/75/85/100); Excel-style header menus; frozen Doc#/Title; merge/override upload.
- **2026-06-08 — Prior.** Transmittal PDF + email (Graph) + return-to-vendor Logic App trigger;
  vendor site registry seeded; Graph pagination fix.

## Current data state (project `tjzeahdimbekuizegsky`)
- `mddr_entries` ≈ 96k rows = **6,100 awarded register docs** + **~87k unawarded scope** +
  **2,926 INDEX sector docs**. ~3,700 docs have a `file_link` (openable). All awarded + INDEX docs
  embedded for semantic search.
- **Migrations applied:** 001, 002, 003, `20260608_seed_vendor_sites`, 004, 005, 006, 007.

## Deploy & migration process
- **Production deploys are MANUAL.** `vercel.json` has `git.deploymentEnabled.main = false`, so a
  push to `main` does NOT auto-deploy. Run `vercel --prod` from the repo to deploy. **Vercel crons
  register only on a production deploy.**
- **DB migrations are applied by hand** in the Supabase SQL editor (DocControl project
  `tjzeahdimbekuizegsky` — NOT CoreTime `ssyvxiqlcxfqomdklakr`). All migrations are idempotent.
- Commit to `main`; end commit messages with the Co-Authored-By trailer.

---

## 2026-06-25 — MDDR refresh-upload + Rules of Credit (feeds CoreReports Engineering doughnut)

- **Refresh-upload:** the "Upload Register" modal default mode is now **"Refresh dates & progress"** —
  drag a vendor SDDR/CDDL and it updates planned/actual dates + `% Complete → progress_percent` on
  matching docs (matched on the RDMC doc number), adds new docs, leaves revision/status alone.
  Idempotent (a re-drop with no changes writes nothing). `lib/mddr/{mapping,import}.ts`; date parsing
  fixed (was −1 day via toISOString). `scripts/preview-import.ts <file> <PKG> [TYPE] [--apply]`.
- **Rules of Credit (engineering progress basis):** agreed with Siemens (4-Jun-2026) — 25% submitted /
  75% reviewed / 85% A1-accepted / 100% final IFC/IFD (`lib/mddr/rules-of-credit.ts`). Applied to
  **Siemens K125** (from review outcomes) + **PPE K124** (from aconex status; `computeProgressFromStatus`)
  via `scripts/apply-rules-of-credit.ts --apply` (`progress_source='rules_of_credit'`, sync skips these).
  **ABB packages keep their SDDR-reported %.** **RES — Reserved Placeholder** docs are excluded from progress.
- Result: per-package engineering % read live by CoreReports (separate Supabase, federated). Deploy:
  auto-deploy OFF — `vercel link` (doccontrol-app, morne-s-projects1) then `vercel --prod`. Prod = docs.coreflow.build.
