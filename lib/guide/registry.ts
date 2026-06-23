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
    images: ['/guide/reviews.png'],
    intro: 'The documents assigned to you to review, and where you record your review outcome.',
    tips: [
      'Open a document to view it (and any markups), then set your status — e.g. approved, approved-with-comments, or rejected/returned.',
      'Add review comments; these flow back to the Document Controller and onto the transmittal.',
      'Clear your list before the due date — overdue reviews hold up the whole document cycle.',
    ],
  },
  {
    match: '/transmittals',
    title: 'Transmittals',
    images: ['/guide/transmittals.png'],
    intro: 'Formal issue and receipt of documents — the auditable record of what was sent to whom, when, and why.',
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
    intro: 'Search the master document register — find any deliverable by number, title, discipline, status or revision.',
    tips: [
      'Type a document number or title; use the filters (discipline, status, vendor, revision) to narrow the list.',
      'Open a document to see its full history — every revision, review and transmittal it has been through.',
      'This is the quickest way to answer "what’s the latest revision / status of X?".',
    ],
  },
  {
    match: '/mddr',
    title: 'MDDR — Master Register',
    images: ['/guide/mddr.png'],
    intro: 'The Master Deliverables & Document Register — the controlled master list of every deliverable, its planned dates, current revision and status.',
    tips: [
      'Each row is a deliverable with its document number, title, discipline, planned vs actual dates and current status/revision.',
      'Filter by package / vendor / discipline / status to focus on a slice of the register.',
      'This is the single source of truth for deliverable progress — it drives the reporting and the client returns.',
    ],
  },
  {
    match: '/reporting',
    title: 'Reporting',
    images: ['/guide/reporting.png'],
    intro: 'Progress and status reports built from the live register — for the project team and the client.',
    tips: [
      'Status / progress reports summarise the register by discipline, vendor or package.',
      'Use these for the document-control return and to spot bottlenecks (overdue reviews, ageing batches).',
      'Reports read live from the MDDR, so they are always current — no manual spreadsheet upkeep.',
    ],
  },

  // ── Admin ────────────────────────────────────────────────
  {
    match: '/admin/import',
    title: 'Import & Sync',
    images: ['/guide/admin-import.png'],
    intro: 'Bring documents and metadata in — bulk import of the document index and the SharePoint / Aconex sync (admin only).',
    tips: [
      'Import a document-index spreadsheet to seed or update the register in bulk.',
      'Run the SharePoint sync to pull the latest files/metadata into CoreDocs.',
      'Imports are designed to be safe to re-run; check the result summary after each run.',
    ],
  },
  {
    match: '/admin/users',
    title: 'Users',
    images: ['/guide/admin-users.png'],
    intro: 'Manage who can access CoreDocs and what they can do — user accounts and roles (admin only).',
    tips: [
      'Each user has a role that controls their menu and permissions: Document Controller, Reviewer, Engineering/Project Manager, Vendor or Admin.',
      'Set a person’s role here; it takes effect on their next page load.',
      'Keep the reviewer list current so batches can be assigned to the right people.',
    ],
  },
  {
    match: '/admin/vendors',
    title: 'Vendors & Packages',
    images: ['/guide/admin-vendors.png'],
    intro: 'The vendors and work packages that documents belong to (admin only).',
    tips: [
      'Maintain the list of vendors and the packages/disciplines they deliver against.',
      'Correct vendor/package setup is what lets batches, the register and reporting group documents properly.',
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
