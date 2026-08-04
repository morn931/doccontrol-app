// Create the isolated "Internal Review" document library in the DocumentControl site.
// This is where Phase-1 internal-review working documents (Word/Excel/PDF) live — kept
// separate from the package/Aconex-synced libraries the site engineers use. Idempotent.
// Falls back to a folder in the default library if the Graph app can't create a list.
import fs from 'fs'

const LIB = 'Internal Review'
const SITE = 'https://ppetechcoza.sharepoint.com/sites/DocumentControl'
const env = {}
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) { const i = l.indexOf('='); if (i < 0) continue; env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n/g, '').trim() }
const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase()

async function token() {
  const r = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default' }) })
  if (!r.ok) throw new Error(`token ${r.status} ${await r.text()}`); return (await r.json()).access_token
}

const tok = await token()
const G = (p, o = {}) => fetch(`https://graph.microsoft.com/v1.0${p}`, { ...o, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...o.headers } })
const u = new URL(SITE); const siteId = (await (await G(`/sites/${u.hostname}:${u.pathname}`)).json()).id

// already exists?
const drives = (await (await G(`/sites/${siteId}/drives`)).json()).value || []
if (drives.find(d => norm(d.name) === norm(LIB))) { console.log(`• "${LIB}" library already exists in DocumentControl`); process.exit(0) }

// try to create a proper document library (list)
const mk = await G(`/sites/${siteId}/lists`, { method: 'POST', body: JSON.stringify({ displayName: LIB, list: { template: 'documentLibrary' } }) })
if (mk.ok) { console.log(`✓ created "${LIB}" document library in DocumentControl`); process.exit(0) }
console.log(`… could not create a library (${mk.status}: ${(await mk.text()).slice(0, 140)}) — falling back to a folder`)

// fallback: folder in the default drive
const defDrive = (await (await G(`/sites/${siteId}/drive`)).json()).id
const exists = await G(`/drives/${defDrive}/root:/${encodeURIComponent(LIB)}?$select=id`)
if (exists.ok) { console.log(`• folder "${LIB}" already exists in the default library`); process.exit(0) }
const fmk = await G(`/drives/${defDrive}/root/children`, { method: 'POST', body: JSON.stringify({ name: LIB, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }) })
console.log(fmk.ok ? `✓ created folder "${LIB}" in the default DocumentControl library` : `✗ folder create failed: ${fmk.status} ${(await fmk.text()).slice(0, 140)}`)
