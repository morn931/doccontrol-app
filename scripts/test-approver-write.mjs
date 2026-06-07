/**
 * test-approver-write.mjs  (v4 — Option B: write to Approver Picks)
 *
 * Tests patching the Approver Picks (Agent) row with:
 *   - ApproverEmailLookupIds: [9, 55]   ← multi-person Person/Group field
 *   - ReadyToStart: true
 *
 * This triggers va-sequential-notify which creates the Document Approval List
 * rows with the Approver field correctly populated.
 *
 * Known SP user IDs (from v2 test):
 *   mornec@ppetech.co.za  → UIL item.id = 9
 *   liezlc@ppetech.co.za  → UIL item.id = 55
 *
 * Run: node scripts/test-approver-write.mjs
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
for (const line of readFileSync(join(__dir, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.+)$/)
  if (m) process.env[m[1]] = m[2].trim()
}

const TENANT_ID     = process.env.MICROSOFT_TENANT_ID
const CLIENT_ID     = process.env.MICROSOFT_CLIENT_ID
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET
const SITE_URL      = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL.replace(/\/$/, '')

const APPROVER_PICKS_LIST_ID = 'b5978f12-495c-49b6-bff4-3392a8d2a681'

// Last test batch GUID (from most recent CSV export)
const TEST_BATCH_GUID = '26f67692-585c-4f8b-93be-161e33f69f9e'

// Confirmed SP user IDs from v2 test
const REVIEWERS = [
  { email: 'mornec@ppetech.co.za',  name: 'Morne Cronje',  uilId: 9,  seq: 1 },
  { email: 'liezlc@ppetech.co.za',  name: 'Liezl Cronje',  uilId: 55, seq: 2 },
]

async function getToken() {
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default',
    }),
  })
  const d = await res.json()
  if (!res.ok) throw new Error(`Token: ${JSON.stringify(d)}`)
  return d.access_token
}

async function g(token, path, opts = {}) {
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await res.text()
  let json = {}
  try { json = JSON.parse(text) } catch {}
  return { ok: res.ok, status: res.status, text, json }
}

async function main() {
  console.log('=== Approver Picks write test (Option B) ===\n')

  const token = await getToken()
  const url = new URL(SITE_URL)
  const siteRes = await g(token, `/sites/${url.hostname}:${url.pathname}`)
  const siteId = siteRes.json.id
  console.log('Site ID:', siteId)

  // ── 1. Find the Approver Picks row for our test batch ──────────────────────
  console.log(`\n── Finding Approver Picks row for batch ${TEST_BATCH_GUID} ──`)
  const findRes = await g(token,
    `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items?$expand=fields&$filter=fields/BatchID eq '${TEST_BATCH_GUID}'&$top=5`,
    { headers: { 'Prefer': 'HonorNonIndexedQueriesWarningMayFailRandomly' } }
  )
  console.log(`  Query status: ${findRes.status}`)

  let picksItemId = null
  if (findRes.ok && findRes.json.value?.length > 0) {
    const row = findRes.json.value[0]
    picksItemId = row.id
    const f = row.fields
    console.log(`  Found row ID: ${picksItemId}`)
    console.log(`  Title (files):    ${JSON.stringify(f?.Title)?.slice(0, 100)}`)
    console.log(`  BatchID:          ${f?.BatchID}`)
    console.log(`  ReadyToStart:     ${f?.ReadyToStart}`)
    console.log(`  ApproverEmail:    ${JSON.stringify(f?.ApproverEmail)}`)
    const claimsKey = Object.keys(f || {}).find(k => k.includes('Claims') || k.includes('approver') || k.includes('Approver'))
    if (claimsKey) console.log(`  ${claimsKey}:  ${JSON.stringify(f[claimsKey])?.slice(0, 200)}`)

    // Show ALL fields with "Approver" in the name
    console.log('\n  All Approver-related fields:')
    for (const [k, v] of Object.entries(f || {})) {
      if (k.toLowerCase().includes('approver')) {
        console.log(`    ${k}: ${JSON.stringify(v)?.slice(0, 150)}`)
      }
    }
  } else {
    console.log(`  Not found. Response: ${findRes.text.slice(0, 300)}`)
    console.log('\n  Trying to list first 5 Approver Picks rows to find one to test with...')
    const listRes = await g(token,
      `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items?$expand=fields($select=Title,BatchID,ReadyToStart,ID)&$top=5&$orderby=id desc`
    )
    if (listRes.ok) {
      for (const item of listRes.json.value || []) {
        console.log(`  ID=${item.id}  BatchID=${item.fields?.BatchID}  ReadyToStart=${item.fields?.ReadyToStart}  Title=${String(item.fields?.Title).slice(0,60)}`)
      }
    }
  }

  if (!picksItemId) {
    console.log('\n⚠️  No row found — update TEST_BATCH_GUID at the top of this script with a valid batch ID from above.')
    return
  }

  // ── 1b. Dump ALL raw field names returned for this item ───────────────────
  console.log('\n── All raw field keys on item 842 ──')
  const rawRes = await g(token, `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items/${picksItemId}/fields`)
  if (rawRes.ok) {
    for (const [k, v] of Object.entries(rawRes.json || {})) {
      console.log(`  ${k}: ${JSON.stringify(v)?.slice(0, 100)}`)
    }
  }

  // ── 1c. List column definitions to find the Person field internal name ─────
  console.log('\n── Approver Picks column definitions (Person/Group fields only) ──')
  const colRes = await g(token, `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/columns`)
  if (colRes.ok) {
    for (const col of colRes.json.value || []) {
      if (col.personOrGroup || col.name?.toLowerCase().includes('approver') || col.displayName?.toLowerCase().includes('approver')) {
        console.log(`  name="${col.name}"  displayName="${col.displayName}"  type=${JSON.stringify(col.personOrGroup ?? col.text ?? col.boolean ?? '?')}`)
      }
    }
  }

  // ── 2. Test: PATCH multi-person ApproverEmail field ────────────────────────
  console.log(`\n── PATCH attempt: ApproverEmailLookupIds (multi-person) ──`)
  const uilIds = REVIEWERS.map(r => r.uilId)
  console.log(`  UIL IDs to write: ${JSON.stringify(uilIds)}`)

  // Try ApproverEmailLookupIds (multi-person plural format)
  const patch1 = await g(token,
    `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items/${picksItemId}/fields`,
    { method: 'PATCH', body: JSON.stringify({ ApproverEmailLookupIds: uilIds }) }
  )
  console.log(`  ApproverEmailLookupIds: HTTP ${patch1.status}  ${patch1.ok ? '✅' : '❌ ' + patch1.text.slice(0, 200)}`)

  if (!patch1.ok) {
    // Try with @odata.type hint (required for some multi-value fields)
    const patch1b = await g(token,
      `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items/${picksItemId}/fields`,
      { method: 'PATCH', body: JSON.stringify({
          'ApproverEmail@odata.type': 'Collection(Edm.Int32)',
          'ApproverEmailLookupIds': uilIds
      })}
    )
    console.log(`  +odata.type hint:        HTTP ${patch1b.status}  ${patch1b.ok ? '✅' : '❌ ' + patch1b.text.slice(0, 200)}`)

    // Try using the field name found from columns inspection
    // (will be filled in after we see the column dump above)
    const patch1c = await g(token,
      `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items/${picksItemId}/fields`,
      { method: 'PATCH', body: JSON.stringify({ Approver_x0020_EmailLookupIds: uilIds }) }
    )
    console.log(`  Approver_x0020_EmailLookupIds: HTTP ${patch1c.status}  ${patch1c.ok ? '✅' : '❌ ' + patch1c.text.slice(0, 150)}`)
  }

  // ── 3. Test: PATCH ReadyToStart ─────────────────────────────────────────────
  console.log(`\n── PATCH ReadyToStart = true ──`)
  const patch2 = await g(token,
    `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items/${picksItemId}/fields`,
    { method: 'PATCH', body: JSON.stringify({ ReadyToStart: true }) }
  )
  console.log(`  ReadyToStart = true: HTTP ${patch2.status}  ${patch2.ok ? '✅' : '❌ ' + patch2.text.slice(0, 200)}`)

  // ── 4. Read back to confirm ─────────────────────────────────────────────────
  console.log(`\n── Read back row ${picksItemId} ──`)
  const readBack = await g(token,
    `/sites/${siteId}/lists/${APPROVER_PICKS_LIST_ID}/items/${picksItemId}/fields`
  )
  if (readBack.ok) {
    const f = readBack.json
    console.log(`  ReadyToStart: ${f?.ReadyToStart}`)
    console.log(`  ApproverEmail: ${JSON.stringify(f?.ApproverEmail)?.slice(0, 200)}`)
    for (const [k, v] of Object.entries(f || {})) {
      if (k.toLowerCase().includes('approver')) {
        console.log(`  ${k}: ${JSON.stringify(v)?.slice(0, 150)}`)
      }
    }
  }

  // NOTE: NOT resetting ReadyToStart — it was already true and we WANT PA to fire.
  // PA trigger: ReadyToStart=true AND ApproverEmail#Claims non-empty (now satisfied).
  // Wait up to 3 minutes for va-sequential-notify to create the DAL rows with Approver set.

  console.log('\n=== Done ===')
  console.log('\nIf ApproverEmailLookupIds PATCH was ✅ and ApproverEmail shows reviewer names in read-back,')
  console.log('we can update start-review to PATCH Approver Picks + ReadyToStart=true instead of creating DAL rows directly.')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })
