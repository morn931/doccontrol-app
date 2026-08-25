/**
 * Hunt for the carry-over documents whose file we could not find.
 *
 * `mddr_entries` has no file_link for them, but that only means the REGISTER does not know
 * where the file is — it does not mean the file is absent. Roelien says these were saved to
 * ENG2, so this LISTS its libraries outright and matches on the document number, then writes
 * file_link back so the document opens in the register.
 *
 * Listing, not searching: Graph's /search/query refuses app-only credentials (400), and
 * per-drive search is index-dependent — it can return nothing for a file that is plainly
 * there. A full listing is slower and certain.
 *
 * A hit must contain the document number in its NAME. Matching on content would drag in
 * every document that merely references this one, and a wrong file behind a register row is
 * worse than an empty one.
 *
 *   npx tsx scripts/find-missing-files.ts            # report
 *   npx tsx scripts/find-missing-files.ts --apply    # write file_link on confident hits
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim()
  if (!t || t.startsWith('#') || !t.includes('=')) continue
  const i = t.indexOf('=')
  const k = t.slice(0, i).trim()
  const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '').replace(/\\n|\\r/g, '').trim()
  if (!(k in process.env)) process.env[k] = v
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})
const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

let tok: { v: string; exp: number } | null = null
async function graphToken(): Promise<string> {
  if (tok && Date.now() < tok.exp) return tok.v
  const res = await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('Graph token failed')
  tok = { v: j.access_token, exp: Date.now() + 45 * 60 * 1000 }
  return tok.v
}

async function graph(url: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url.startsWith('http') ? url : `https://graph.microsoft.com/v1.0${url}`, {
      headers: { Authorization: `Bearer ${await graphToken()}` },
    })
    if (res.ok) return res.json()
    // SharePoint throttles a deep listing; back off rather than lose the whole crawl
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    throw new Error(`Graph ${res.status} ${(await res.text()).slice(0, 160)}`)
  }
}

/**
 * Roelien pointed at SPECIFICATIONS, and most of them are indeed there — but not all, so
 * every ENG2 library is listed. Per-drive search is NOT enough on its own: it is index-
 * dependent and returned nothing for files a listing then found sitting in plain view.
 */
const ENG2 = 'ppetechcoza.sharepoint.com:/sites/ENG2'
const LIBRARIES = [
  'SPECIFICATIONS', 'INSTRUMENTATION', 'ELECTRICAL', 'MECHANICAL', 'CIVIL',
  'AUTOMATION', 'PROJECT CONTROLS & GENERAL', 'FROM PPE', 'TO PPE', 'Documents',
].map((library) => ({ site: ENG2, library }))

type File = { name: string; webUrl: string; size: number; modified: string; folder: string }

/** Every file in a library, folders and all. */
async function listLibrary(siteRef: string, libraryName: string): Promise<File[]> {
  const site = await graph(`/sites/${siteRef}`)
  const drives = (await graph(`/sites/${site.id}/drives`)).value as Record<string, unknown>[]
  const drive = drives.find((d) => norm(d.name) === norm(libraryName))
  if (!drive) {
    throw new Error(`no library "${libraryName}" on ${siteRef} — found: ${drives.map((d) => d.name).join(', ')}`)
  }

  const out: File[] = []
  const queue = [{ id: 'root', path: '' }]
  while (queue.length) {
    const dir = queue.shift()!
    let url = `/drives/${drive.id}/items/${dir.id}/children?$top=200&$select=id,name,size,webUrl,folder,file,lastModifiedDateTime`
    while (url) {
      const page = await graph(url)
      for (const it of (page.value ?? []) as Record<string, unknown>[]) {
        const name = String(it.name)
        if (it.folder) queue.push({ id: String(it.id), path: `${dir.path}/${name}` })
        else out.push({
          name,
          webUrl: String(it.webUrl ?? ''),
          size: Number(it.size ?? 0),
          modified: String(it.lastModifiedDateTime ?? '').slice(0, 10),
          folder: dir.path || '/',
        })
      }
      url = String(page['@odata.nextLink'] ?? '')
      if (out.length % 1000 === 0 && out.length) process.stdout.write(`\r  …${out.length} files`)
    }
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')

  // ONLY the K038 rows. A tender-folder row has no file_link either, but its file sits in the
  // OneDrive transfer folder and opens perfectly well — including those would report 100
  // "missing" documents when 13 are missing.
  //
  // A STALE link counts as missing too: the register points at a file SharePoint no longer
  // has, usually because the document was re-issued under a new revision suffix. Those get
  // re-pointed at whatever is on the library today. Where several revisions of one document
  // are present the newest PDF wins, and the hit count is printed so a close call is visible.
  const { data, error } = await db
    .from('cddl_carryover')
    .select('temp_ref,legacy_docno,title,ai_status,ai_error,file_link,source')
    .eq('source', 'k038 highlighted')
    .not('legacy_docno', 'is', null)
    .or('file_link.is.null,ai_error.ilike.%could not be located%')
    .order('temp_ref')
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const stale = rows.filter((r) => r.file_link).length
  console.log(`${rows.length} K038 document(s) to place${stale ? ` (${stale} with a stale link)` : ''}.\n`)

  const files: File[] = []
  for (const lib of LIBRARIES) {
    console.log(`Listing ${lib.site.split('/').pop()} / ${lib.library} …`)
    const f = await listLibrary(lib.site, lib.library)
    console.log(`\r  ${f.length} files.            `)
    files.push(...f)
  }
  console.log()

  let found = 0
  for (const r of rows) {
    const docNo = String(r.legacy_docno)
    const want = norm(docNo)
    const hits = files.filter((f) => norm(f.name).includes(want))
    const label = `  ${r.temp_ref}  ${docNo.padEnd(28)} ${(r.file_link ? 'stale link' : 'no link').padEnd(11)}`
    if (!hits.length) {
      console.log(`${label} not here`)
      continue
    }
    found++
    // prefer a PDF (what the register should open), then the most recent
    const best = hits.sort((a, b) =>
      (b.name.toLowerCase().endsWith('.pdf') ? 1 : 0) - (a.name.toLowerCase().endsWith('.pdf') ? 1 : 0)
      || b.modified.localeCompare(a.modified))[0]
    console.log(`${label} FOUND${hits.length > 1 ? ` (${hits.length})` : ''}: ${best.folder}/${best.name}`)
    if (apply) {
      const { error: upErr } = await db.from('cddl_carryover')
        // ai_read_at is cleared as well, not just ai_error. A stale-link row HAS been
        // attempted, so it carries a read timestamp; clearing only the error would hide it
        // from both reader modes at once — --retry looks for an error, a plain run for a
        // missing timestamp — and it would silently never be read.
        .update({ file_link: best.webUrl, ai_error: null, ai_read_at: null })
        .eq('temp_ref', r.temp_ref)
      if (upErr) console.log(`       write failed: ${upErr.message}`)
    }
  }

  console.log(`\n${found} of ${rows.length} located${apply ? ' and linked' : ''}.`)
  if (found && !apply) console.log('(report only — re-run with --apply to write file_link)')
  if (found && apply) console.log('Then: npx tsx scripts/read-carryover.ts --retry')
}

main().catch((e) => { console.error(e); process.exit(1) })
