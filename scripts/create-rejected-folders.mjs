// Create a "Rejected Files" folder in each active vendor site's drop-off library — the
// SAME library the reject flow moves rejected documents into. Drop-off library names
// vary per vendor AND several were renamed since intake, so we resolve the library the
// way moveFileToRejectedFolder() does: derive it from the first segment of a real
// source_file_url, then fall back to searching the site's drop-off libraries for that
// file (the in-library path survives a rename). Idempotent (get-or-create).
//
//   node scripts/create-rejected-folders.mjs --dry   # resolve + report only (no writes)
//   node scripts/create-rejected-folders.mjs         # create the folders
import fs from 'fs'

const DRY = process.argv.includes('--dry')
const REJECTED = 'Rejected Files'
const env = {}
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const i = l.indexOf('='); if (i < 0) continue; env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '').trim() }
const SB = 'https://tjzeahdimbekuizegsky.supabase.co', SK = (env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/[^A-Za-z0-9._-]/g, ''), SBH = { apikey: SK, Authorization: `Bearer ${SK}` }
const norm = s => (s || '').replace(/^\//, '').replace(/\s+/g, ' ').trim().toLowerCase()

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default' }) })
  if (!r.ok) throw new Error(`token ${r.status}`); return (await r.json()).access_token
}

async function run() {
  const tok = await token()
  const G = (p, o = {}) => fetch(`https://graph.microsoft.com/v1.0${p}`, { ...o, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...o.headers } })
  const sites = await (await fetch(`${SB}/rest/v1/vendor_sites?select=site_url&active=eq.true`, { headers: SBH })).json()

  for (const s of sites) {
    const short = s.site_url.split('/sites/')[1] || s.site_url
    const dv = await (await fetch(`${SB}/rest/v1/document_versions?select=source_file_url&source_site_url=eq.${encodeURIComponent(s.site_url)}&source_file_url=not.is.null&order=uploaded_at.desc.nullslast&limit=1`, { headers: SBH })).json()
    const path = dv[0]?.source_file_url
    if (!path) { console.log(`— ${short}: no vendor files on record, skipping`); continue }
    const segs = path.replace(/^\/+/, '').split('/').filter(Boolean); const lib = segs[0]; const enc = segs.slice(1).map(encodeURIComponent).join('/')
    try {
      const u = new URL(s.site_url); const siteId = (await (await G(`/sites/${u.hostname}:${u.pathname}`)).json()).id
      const drives = (await (await G(`/sites/${siteId}/drives`)).json()).value || []
      const tryd = async id => (await G(`/drives/${id}/root:/${enc}?$select=id`)).ok
      let drive = drives.find(d => norm(d.name) === norm(lib)); if (drive && !(await tryd(drive.id))) drive = null
      if (!drive) for (const d of drives.filter(d => /^from\b/i.test(d.name) || /drop/i.test(d.name))) { if (await tryd(d.id)) { drive = d; break } }
      if (!drive) { console.log(`✗ ${short}: could not resolve the drop-off library (recorded "${lib}")`); continue }
      const exists = await G(`/drives/${drive.id}/root:/${encodeURIComponent(REJECTED)}?$select=id`)
      if (exists.ok) { console.log(`• ${short}: "${REJECTED}" already in "${drive.name}"`); continue }
      if (DRY) { console.log(`~ ${short}: WOULD create "${REJECTED}" in "${drive.name}"`); continue }
      const mk = await G(`/drives/${drive.id}/root/children`, { method: 'POST', body: JSON.stringify({ name: REJECTED, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) })
      console.log(mk.ok ? `✓ ${short}: created "${REJECTED}" in "${drive.name}"` : `✗ ${short}: ${mk.status} ${(await mk.text()).slice(0, 120)}`)
    } catch (e) { console.log(`✗ ${short}: ${e.message}`) }
  }
}
run().catch(e => { console.error(e); process.exit(1) })
