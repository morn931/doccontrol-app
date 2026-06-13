# DocControl App — Project Context for Claude

## What This Is
A modern web-based document approval & control system for PPE Tech (PPE Technologies), replacing an existing SharePoint / Power Apps / Logic Apps system. The new app runs **in parallel** with the old system — both can be used simultaneously. Nothing in the old system has been removed or overridden.

**Live URL:** https://doccontrol-app.vercel.app  
**Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres), Vercel, Microsoft Graph API, Azure Document Intelligence, Azure OpenAI  
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
- **Activity IDs** are not populated in the supplied registers (CDDL column blank, GMDR has
  none) → P6 export has nothing to carry yet; mapping is ready for when they appear.
- **Reporting** off the MDDR (progress roll-ups by package/vendor; P6 Activity-ID export).

## Reporting (menu: **Reporting**, `/reporting`)

Reports computed live off the MDDR. Charts use **recharts**.

- **Progress Dashboard** (`/reporting/dashboard`) — 4 charts: Planned-vs-Actual **S-curve**
  (cumulative %, over docs with a planned date), Planned vs Actual by package (bars), Document
  Maturity by Rules-of-Credit milestone (donut), and Schedule Variance by package (diverging bars).
  MDDR-style filters (package/vendor/source/awarded) tailor all charts and flow into each chart's
  heading; KPI tiles + on-chart data labels make it print/screenshot-friendly. API
  `app/api/reporting/dashboard` (accepts the same filter params).

Reports computed live off the MDDR. Three detail reports:
- **Engineering Tracker** (`/reporting/engineering-tracker`) — by package; EVM hours/progress.
- **Package Progress Summary** (`/reporting/package-progress`) — by package; doc counts & progress.
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
app/
  (app)/
    batches/          — batch list + detail pages
    transmittals/     — transmittal history
    reviews/          — reviewer queue
    documents/        — document search/retrieval
  api/
    batches/[id]/
      route.ts                    — batch CRUD
      generate-transmittal/       — PDF generation + email + return trigger
      debug-return/               — diagnostic (remove when done)
      start-review/               — kicks off sequential review
      reject/                     — reject batch before review
    intake/webhook/               — receives vendor upload notifications
    reviews/[id]/
      route.ts                    — review task details
      submit/                     — reviewer submits outcome
      context/                    — loads review context + document URL
    admin/import/                 — imports batches from old SharePoint system
lib/
  services/
    graph.ts                      — Microsoft Graph API client
    sharepoint-lists.ts           — SP list read/write (DAL + Approver Picks)
    document-intelligence.ts      — Azure OCR
    openai.ts                     — AI classification
    email-templates.ts            — HTML email templates
  utils/
    outcome-codes.ts              — outcome code definitions
supabase/
  migrations/
    001_initial_schema.sql
    002_search_indexes.sql
    003_rls_policies.sql
    20260608_seed_vendor_sites.sql — vendor registry from CSV
```

---

## Pending / Next Steps

1. **Confirm return-to-vendor end-to-end** on a clean production batch (K108 test batch had stale DAL data — not a code bug)
2. **Remove debug endpoint** `app/api/batches/[id]/debug-return/route.ts` once confirmed
3. **Run vendor_sites migration** in Supabase SQL editor if not yet done (`20260608_seed_vendor_sites.sql`)
4. Vendor portal upload interface (currently vendors still upload to SharePoint; long-term: direct upload to new app)
5. Engineering Manager override / escalation flow
6. Return-to-vendor status update (`ReturnComplete = true`) after Logic App completes

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
AZURE_OPENAI_KEY
PDF_ANNOTATION_FUNCTION_URL
VENDOR_PORTAL_URL
```

---

## How to Resume Work in a New Conversation

1. Open Cowork and connect this folder (`doccontrol-app`) or the `Document management` project folder
2. Say: *"Continue work on the PPE Tech doccontrol app — read CLAUDE.md for full context"*
3. Claude will read this file and be fully up to speed immediately

This file should be updated at the end of each work session with new progress.
**Last updated: 2026-06-09** — MDDR module built, loaded & live in production
(`doccontrol-app.vercel.app/mddr`). Migration 004 applied to project `tjzeahdimbekuizegsky`.
All 9 registers imported and reconciled to ONE master per document number: **6,078 awarded
docs + ~87,400 unawarded scope rows**. The discipline/type delimiter reconciliation merged
636 SDDR↔GMDR duplicate pairs (e.g. `…-E-GAD-…` ↔ `…-EGAD-…`); 1,039 docs now carry both
master + vendor-register data in one row. Rules-of-Credit progress (25/75/85/100) synced
**470 docs** from the live review system (85 @25%, 120 @75%, 265 @85%; no 100% yet — none at
numeric Rev 0 IFC/IFD). UI: package→vendor→source + awarded/scope filters, frozen
Doc#/Title columns with always-visible horizontal scroll, top-left Doc Number quick-filter,
column picker, CSV export, Upload (merge/override), Sync Progress. Fixed a sync pagination
bug (offset paging without `.order` undercounted matches) and made `--wipe` batch-delete.
**Reporting menu added with three live reports off the MDDR:** (1) Engineering Tracker
(by package; EVM tracker — reproduces the workbook budget columns exactly: K125 F=2138,
E102 F=1063, Eng subtotal F=63,675; fixed the sheet's % of Proj / % of Discpl ratio errors);
(2) Package Progress Summary (by package; doc counts, planned vs actual %, variance — backed by
the shared `aggregatePackages`); (3) PPE Phase 1 Engineering Deliverables (by **WBS code**,
**CDDL only**; 3-milestone Rev A/Rev 0/Approved completion; placeholders = 0%). Each is
package/WBS-filterable with CSV export. Next: print/PDF views + P6 Activity-ID export
(Activity IDs not yet present in source registers).
**Document Search** reworked to query the MDDR (the full register, not just the 790 live docs):
MDDR-style filters (package/vendor/source/awarded) + discipline/doc-type/status dropdowns +
separate **Doc Number** and **Title** search boxes (`/api/mddr` gained `docnum`, `title`,
`discipline`, `document_type`, `status` params; `/api/mddr/meta` now also returns distinct
disciplines/documentTypes/statuses). **Vendors & Packages** now shows the awarded vendor per
package (`lib/package-vendors.ts`; default "Not awarded yet"; K124 = PPE).
**Prior:** Transmittal PDF, email send, return-to-vendor Logic App trigger working; vendor
site registry seeded; Graph API pagination fix.
