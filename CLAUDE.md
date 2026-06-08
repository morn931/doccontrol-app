# DocControl App — Project Context for Claude

## What This Is
A modern web-based document approval & control system for PPE Tech (PPE Technologies), replacing an existing SharePoint / Power Apps / Logic Apps system. The new app runs **in parallel** with the old system — both can be used simultaneously. Nothing in the old system has been removed or overridden.

**Live URL:** https://doccontrol-app.vercel.app  
**Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres), Vercel, Microsoft Graph API, Azure Document Intelligence, Azure OpenAI  
**Repo:** `C:\Users\mornec\Claude\Projects\Document management (1)\doccontrol-app`  
**Owner:** Morné Cronjé — mornec@ppetech.co.za

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
**Last updated: 2026-06-08** — Transmittal PDF, email send, and return-to-vendor Logic App trigger all working. Vendor site registry seeded. Pagination fix for Graph API applied.
