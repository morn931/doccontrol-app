/**
 * Per-screen Guide content — single source of truth for the in-app "Guide" button
 * (components/guide-button) AND the full in-app manual (/help) AND the generated
 * Word user guide (scripts/build_user_guide.py). Each entry maps a CoreDocs route to
 * its screenshot + a short "how to use this screen" with the purpose of each function.
 *
 * Matching: the entry whose `match` is the longest prefix of the current path wins,
 * so /admin/users beats /admin.
 *
 * Mirrors the CoreTime guide pattern (coretime/src/lib/guide/registry.ts).
 */
export interface GuideEntry {
  match: string            // route path this applies to
  title: string
  images: string[]         // under /public — first is the primary
  intro: string
  tips: string[]           // each = a function on the screen + how to use it
  anchor?: string          // override for the full-guide section id (defaults to slug)
}

/** URL-safe id for the full guide (/help) section + popup deep links. */
export function slug(match: string): string {
  return match.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\//g, '-') || 'dashboard'
}
export function anchorFor(e: GuideEntry): string {
  return e.anchor ?? slug(e.match)
}

export const GUIDE: GuideEntry[] = [
  {
    match: '/dashboard',
    title: 'Dashboard',
    images: ['/guide/dashboard.png'],
    intro: 'Your home screen — an at-a-glance view of the document-control workload and the way in to every part of CoreDocs.',
    tips: [
      'The left sidebar is your main menu — what you see depends on your role (Document Controller, Reviewer, Engineering/Project Manager, Vendor or Admin).',
      'The summary cards show the current state of play — batches awaiting action, reviews due, documents by status. Click one to jump straight in.',
      'Use the top-right menu for your account and to sign out. The "Guide" button (top of every page) explains the screen you are on.',
    ],
  },

  // ── Document Controller workflow ─────────────────────────
  {
    match: '/batches',
    title: 'Incoming Batches',
    images: ['/guide/batches.png'],
    intro: 'Vendor document batches as they arrive — the Document Controller’s inbox for logging and distributing new submissions.',
    tips: [
      'Each batch is a set of documents submitted together (from Aconex / the vendor). Open one to see its documents and metadata.',
      'Register the batch into the master register, then assign the documents to the right reviewers / disciplines.',
      'Track a batch’s progress from received → under review → returned, so nothing sits unactioned.',
    ],
  },
  {
    match: '/reviews',
    title: 'My Reviews',
    images: ['/guide/reviews.png', '/guide/review-detail.png'],
    intro: 'The documents assigned to you to review, and where you record your review outcome. The list is split into Pending / In Progress and Completed, with an overdue banner so nothing slips.',
    tips: [
      'Work the top of the list first — anything flagged overdue holds up the whole document cycle. Open a document to view it (and any markups) in the Review Chain.',
      'Record a formal outcome code: A1 (approved), B1/B2 (approved with comments), C1 / D1 (revise & resubmit), Q1 (for quotation), V1 / S1 (information / superseded). Add your comments alongside the code.',
      'Your outcome and comments flow back to the Document Controller and onto the transmittal — once set, the document moves to Completed.',
    ],
  },
  {
    match: '/transmittals',
    title: 'Transmittals',
    images: ['/guide/transmittals.png'],
    intro: 'The Transmittal Register — formal issue and receipt of documents, the auditable record of what was sent to whom, when, and why.',
    tips: [
      'Create a transmittal to issue documents (e.g. returning reviewed vendor docs, or sending for construction) with a cover sheet.',
      'Each transmittal has a unique number and lists its documents, revisions and the reason for issue.',
      'Open a past transmittal to see its full history — the permanent record for audits and claims.',
    ],
  },

  // ── Register & search ────────────────────────────────────
  {
    match: '/documents',
    title: 'Document Search',
    images: ['/guide/documents.png'],
    intro: 'Search the full document register (3,500+ documents) — find any deliverable by number, title, package, vendor or status.',
    tips: [
      'Use Smart Search to describe the document in plain language ("the HV single-line diagram for the substation") — it matches on meaning, not just exact text.',
      'Narrow the list with the Package / Vendor / Source / Sector filters and the Awarded / Unawarded toggle.',
      'Open a document to see its full history — every revision, review and transmittal it has been through. This is the quickest way to answer "what’s the latest revision / status of X?".',
    ],
  },
  {
    match: '/mddr',
    title: 'MDDR — Master Register',
    images: ['/guide/mddr.png'],
    intro: 'The Master Document & Drawing Register — the controlled master list combining the SDDR, CDDL and MDDR into one register of every deliverable (6,000+ entries) with its current revision, status and progress.',
    tips: [
      'Each row is a deliverable with its document number, title, package/discipline, current revision and status. Use Columns to choose what’s shown.',
      'Run Sync Progress to refresh deliverable progress from the latest data; use Upload Register to bulk-load or update entries, and Export CSV for an offline copy or the client return.',
      'This is the single source of truth for deliverable progress — it drives the Reporting dashboards.',
    ],
  },
  {
    match: '/reporting',
    title: 'Reporting',
    images: ['/guide/reporting.png'],
    intro: 'Progress and status reports built live from the register — for the project team and the client.',
    tips: [
      'The reports are: Progress Dashboard (overall % complete), Engineering Tracker, Package Progress Summary, PPE Phase 1 Engineering Deliverables, and the P6 Activity-ID Progress Export.',
      'Use the P6 Activity-ID export to feed deliverable progress straight back into the Primavera P6 schedule.',
      'Everything reads live from the MDDR, so the numbers are always current — no manual spreadsheet upkeep.',
    ],
  },

  // ── Admin ────────────────────────────────────────────────
  {
    match: '/admin/import',
    title: 'Import & Sync',
    images: ['/guide/admin-import.png'],
    intro: 'Bring SharePoint data into CoreDocs — the automatic SharePoint sync and a manual CSV import (admin only). Always run a dry run first to preview before committing.',
    tips: [
      'Automatic SharePoint Sync pulls the Approver Picks and Document Approval lists straight from SharePoint via Microsoft Graph (no CSV needed) — it runs every day at 02:00 UTC. Use "Sync now (force update)" to refresh immediately, "Sync changes only" for just the deltas, or "Preview (dry run)" to see what would change.',
      'To import from a CSV instead: pick the Import Source (e.g. Approver Picks — Batch records), choose a mode — Dry Run (validate only), Full (insert/update all) or Incremental (new records only) — then upload the CSV.',
      'Always start with a Dry Run: it validates and shows what would happen without changing anything. Re-running imports is safe; check the result summary after each run.',
    ],
  },
  {
    match: '/admin/users',
    title: 'Users',
    images: ['/guide/admin-users.png'],
    intro: 'Manage who can access the Document Control platform — user accounts and roles (admin only).',
    tips: [
      'Each user has a role that controls their menu and permissions: Admin, Reviewer, Document Controller, Engineering/Project Manager or Vendor. The badge next to each name shows their current role.',
      'Use "Add User" to invite someone, or "Edit" to change a person’s role — it takes effect on their next page load.',
      'Keep the reviewer list current so incoming batches can be assigned to the right people.',
    ],
  },
  {
    match: '/admin/vendors',
    title: 'Vendors & Packages',
    images: ['/guide/admin-vendors.png'],
    intro: 'The project packages and the vendor each is awarded to (admin only). PPE’s own engineering scope sits under package K124.',
    tips: [
      'Each row is a package (e.g. E101 — 36MVA High Speed Diesel Generator) with an "Awarded: <vendor>" badge, or "Not awarded yet" if the contract isn’t placed.',
      'Set the awarded vendor as packages are placed — this is what lets batches, the register and reporting group documents by package and vendor correctly.',
    ],
  },
]

/** Best Guide entry for a pathname (longest matching prefix), or null. */
export function guideFor(pathname: string): GuideEntry | null {
  let best: GuideEntry | null = null
  for (const e of GUIDE) {
    const prefix = e.match.endsWith('/') ? e.match : e.match + '/'
    if (pathname === e.match || pathname.startsWith(prefix)) {
      if (!best || e.match.length > best.match.length) best = e
    }
  }
  return best
}
