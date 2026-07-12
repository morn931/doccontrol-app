# Icon substitutions — CoreDocs

Logged per the platform icon-sweep rule.

**Exact manifest matches, no substitution needed:** Dashboard → `dashboard`,
Document Search → `document-search`, MDDR → `mddr`, Reporting → `reports`,
Users → `team`, Vendors & Packages → `vendors`, Developer Tools →
`developer-tools`. The dashboard's own quick-access tiles already used
correctly-canonical assets (`/dashboard-card-icons/512/CD-01_Documents.png`
through `CD-07`, matching the manifest's own catalogue numbers exactly —
`CD-01 Documents`, `CD-04 MDDR`, `CD-06 Vendors`, etc.) just stored under a
different path than the standard `/coreflow/icons/` convention — left as-is,
no substitution needed, no path change (avoids unnecessary churn on already
correct assets).

## Substitutions (no exact manifest concept)

| File | Screen / element | Original | Replacement | Why |
|---|---|---|---|---|
| `components/layout/sidebar.tsx` | Incoming Batches, Document Requests, Doc Request Email, User Guide | emoji 📥 / 🔢 / 📧 / 📖 | `icons/documents` | No manifest "batch"/"request"/"email"/"guide" concept; `documents` is the closest generic-document concept for all four. |
| `components/layout/sidebar.tsx` | My Reviews | emoji ✅ | `icons/actions` | No manifest "review/approve" concept; matches the same substitution used elsewhere in the platform for review/approval-adjacent nav items. |
| `components/layout/sidebar.tsx` | Transmittals | emoji 📤 | `icons/reports` | No manifest "transmittal" concept; a transmittal is a formally issued document, closest to `reports`. |
| `components/layout/sidebar.tsx` | Import & Sync | emoji 🔄 | `icons/administration` | No manifest "sync" concept; import/sync is a governance/process task, closest to `administration`. |

## Also fixed (not an icon substitution — a rollout/correctness fix)

- **Duplicate hero removed.** `(app)/dashboard/page.tsx` previously rendered
  its own separate "Welcome back" banner in addition to `(app)/layout.tsx`'s
  shared hero — violates the platform's single-banner rule.
- **Wrong hero image asset.** The `hero-industrial-desktop-*.png` files here
  were byte-different from the canonical set — solid navy fill across the
  whole image, no light/transparent portion. Replaced with the actual
  canonical files from `Coreflow Final Hero Banner files.zip` (the
  `*_inverted` variant — light background, artwork confined to the right).
- **Sidebar restructured** to the platform's floating white rounded card
  pattern (`rounded-xl bg-white border shadow-sm self-start`), matching
  CoreCost/CoreTime/CoreSHERQ — was a full-height `border-r` rail.
