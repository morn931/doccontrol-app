# PPE Tech Document Control App — Phase 1 Setup

## Prerequisites
- Node.js 18+ (on your local machine)
- A Supabase project (create at supabase.com)
- Access to SharePoint CSV exports (already in /My History)

---

## Step 1: Install dependencies

Open a terminal in the `doccontrol-app` folder:

```bash
npm install
```

---

## Step 2: Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

At minimum for Phase 1 you need:

```env
NEXT_PUBLIC_SUPABASE_URL=   # from Supabase dashboard → Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # from Supabase dashboard → Settings → API
SUPABASE_SERVICE_ROLE_KEY=  # from Supabase dashboard → Settings → API (keep secret!)
NEXT_PUBLIC_APP_URL=http://localhost:3000
INTAKE_WEBHOOK_SECRET=any-long-random-string
```

The Azure, SharePoint, and OpenAI variables can be left blank until Phase 2.

---

## Step 3: Run the database migrations

Go to your Supabase project → SQL Editor and run these files IN ORDER:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_search_indexes.sql`
3. `supabase/migrations/003_rls_policies.sql`

Copy and paste the full contents of each file into the SQL editor and click Run.

---

## Step 4: Create your first admin user

In Supabase dashboard → Authentication → Users → Invite user:
- Enter your email and send the invite
- Accept the invite (sets your password)

Then in Supabase SQL Editor:

```sql
INSERT INTO users (auth_user_id, email, full_name, role, active)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'your@email.com'),
  'your@email.com',
  'Your Name',
  'admin',
  true
);
```

---

## Step 5: Start the development server

```bash
npm run dev
```

Open http://localhost:3000 — you'll be redirected to the login page.

---

## Step 6: Import existing SharePoint data

1. Log in as admin
2. Go to Admin → Import & Sync
3. Select source: **Approver Picks (Agent)**
4. Upload: `My History/Approver Picks (Agent) (32) (1).csv`
5. Run **Dry Run** first — check the results
6. Run **Full** import to commit

Then repeat with:
- Source: **Document Approval List (Agent)**
- File: `My History/Document Approval List (Agent) - 2026-03-28T113936.653 (1).csv`

After import, the Dashboard and Document Search will show the imported data.

---

## What's built in Phase 1

| Screen | Status |
|--------|--------|
| Login | ✅ Done |
| Dashboard (stat panels + recent batches) | ✅ Done |
| Incoming Batches list + filter tabs | ✅ Done |
| Batch Detail (documents, review tasks, audit) | ✅ Done |
| Document Search (full-text, latest version, filters) | ✅ Done |
| Document Detail + Revision History | ✅ Done |
| My Reviews list | ✅ Done |
| Transmittal Register | ✅ Done |
| Admin → Import & Sync (CSV upload + dry run) | ✅ Done |
| Intake Webhook endpoint (compatible with existing watcher flows) | ✅ Done |
| Database (14 tables, full-text search, RLS) | ✅ Done |

## What's coming in Phase 2

- Live AI triage (Azure Document Intelligence + OpenAI)
- Batch metadata edit UI
- Reject batch with vendor email
- Assign reviewers UI

## What's coming in Phase 3

- Full sequential reviewer workflow
- PDF viewer with markup
- Review submission + next-reviewer trigger
- Need More Review escalation
