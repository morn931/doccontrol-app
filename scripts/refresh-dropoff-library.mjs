// Refresh vendor_sites.dropoff_library to the REAL current drop-off library per site.
// Several sites renamed their drop-off library since intake, leaving the column stale.
// Resolution mirrors moveFileToRejectedFolder(): find the drive that actually holds the
// site's most recent vendor file (recorded-name first, then a drop-off-library search
// that survives a rename). For sites with no vendor files on record, use the single
// FROM*/Drop* library if there's exactly one. Writes via PostgREST (data update).
//
//   node scripts/refresh-dropoff-library.mjs --dry   # show the diff only
//   node scripts/refresh-dropoff-library.mjs         # apply
import fs from 'fs'

const DRY = process.argv.includes('--dry')
const env = {}
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const i = l.indexOf('='); if (i < 0) continue; env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '').trim() }
const SB = 'https://tjzeahdimbekuizegsky.supabase.co', SK = (env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/[^A-Za-z0-9._-]/g, '')
const SBH = { apikey: SK, Authorization: `Bearer ${SK}` }
const norm = s => (s || '').replace(/^\//, '').replace(/\s+/g, ' ').trim().toLowerCase()
const isDrop = n => (/^from\b/i.test(n) || /drop/i.test(n)) && !/^to\b/i.test(n)

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default' }) })
  if (!r.ok) throw new Error(`token ${r.status}`); return (await r.json()).access_token
}

async function run() {
  const tok = await token()
  const G = p => fetch(`https://graph.microsoft.com/v1.0${p}`, { headers: { Authorization: `Bearer ${tok}` } })
  const sites = await (await fetch(`${SB}/rest/v1/vendor_sites?select=site_url,dropoff_library&active=eq.true`, { headers: SBH })).json()

  for (const s of sites) {
    const short = s.site_url.split('/sites/')[1] || s.site_url
    try {
      const u = new URL(s.site_url); const siteId = (await (await G(`/sites/${u.hostname}:${u.pathname}`)).json()).id
      const drives = (await (await G(`/sites/${siteId}/drives`)).json()).value || []
      let resolved = null

      const dv = await (await fetch(`${SB}/rest/v1/document_versions?select=source_file_url&source_site_url=eq.${encodeURIComponent(s.site_url)}&source_file_url=not.is.null&order=uploaded_at.desc.nullslast&limit=1`, { headers: SBH })).json()
      const path = dv[0]?.source_file_url
      if (path) {
        const segs = path.replace(/^\/+/, '').split('/').filter(Boolean); const lib = segs[0]; const enc = segs.slice(1).map(encodeURIComponent).join('/')
        const tryd = async id => (await G(`/drives/${id}/root:/${enc}?$select=id`)).ok
        let drive = drives.find(d => norm(d.name) === norm(lib)); if (drive && !(await tryd(drive.id))) drive = null
        if (!drive) for (const d of drives.filter(d => isDrop(d.name))) { if (await tryd(d.id)) { drive = d; break } }
        if (drive) resolved = drive.name
      }
      if (!resolved) { const cand = drives.filter(d => isDrop(d.name)); if (cand.length === 1) resolved = cand[0].name }

      if (!resolved) { console.log(`? ${short}: could not resolve (drives: ${drives.map(d => d.name).join(', ')}) — left as "${s.dropoff_library}"`); continue }
      if (norm(resolved) === norm(s.dropoff_library)) { console.log(`• ${short}: "${s.dropoff_library}" (unchanged)`); continue }
      if (DRY) { console.log(`~ ${short}: "${s.dropoff_library}" -> "${resolved}"`); continue }
      const up = await fetch(`${SB}/rest/v1/vendor_sites?site_url=eq.${encodeURIComponent(s.site_url)}`, { method: 'PATCH', headers: { ...SBH, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ dropoff_library: resolved }) })
      console.log(up.ok ? `✓ ${short}: "${s.dropoff_library}" -> "${resolved}"` : `✗ ${short}: PATCH ${up.status} ${(await up.text()).slice(0, 120)}`)
    } catch (e) { console.log(`✗ ${short}: ${e.message}`) }
  }
}
run().catch(e => { console.error(e); process.exit(1) })
