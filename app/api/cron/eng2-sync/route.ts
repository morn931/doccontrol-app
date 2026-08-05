import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getSiteId, graphFetch } from '@/lib/services/graph'

export const runtime = 'nodejs'
export const maxDuration = 300

// Direct ingest of the ENG2 engineering document libraries into mddr_entries, so
// CoreDocs Document Search stays complete regardless of the "Master Site Document
// Index" rollup (which was silently missing ~939 docs, incl. the FD24 series).
// Runs on Vercel (local writes to the CoreDocs DB are blanked by the VPN 204 quirk).

const SITE_URL = process.env.SHAREPOINT_ENGINEERING_SITE_URL || 'https://ppetechcoza.sharepoint.com/sites/ENG2'
// Engineering discipline libraries that produce 6105A…-numbered deliverables.
const LIBS = ['ELECTRICAL', 'INSTRUMENTATION', 'MECHANICAL', 'AUTOMATION', 'CIVIL', 'SPECIFICATIONS', 'PROJECT CONTROLS & GENERAL']

const uuid5 = (name: string) => {
  const h = createHash('sha1').update('eng2-sync:' + name).digest()
  const b = Buffer.from(h.subarray(0, 16)); b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80
  const x = b.toString('hex'); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`
}

function norm(s?: string | null): string | null {
  if (!s) return null
  let x = String(s).trim().toUpperCase()
  if (!x || x === '-' || x === 'N/A') return null
  x = x.replace(/\.[A-Z0-9]{2,4}$/, '')
  x = x.replace(/[_\s]*REV[._\s-]*[A-Z0-9]{1,3}$/, '')
  x = x.replace(/_[A-Z0-9]{1,3}$/, '')
  x = x.replace(/\s+/g, '')
  x = x.replace(/-([A-Z])-([A-Z]{2,4})-/, '-$1$2-')
  return x || null
}
function pkgOf(dn?: string | null): string | null {
  const m = /^6105A([A-Z]\d{3}[A-Z]?)-/i.exec(dn || '')
  return m ? m[1].toUpperCase() : null
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  try {
    const db: any = createServiceClient()

    // 1) existing doc keys — insert-only-new, so we never duplicate docs already
    //    present from the register/index imports.
    const have = new Set<string>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('mddr_entries')
        .select('normalized_document_number').order('id').range(from, from + 999)
      if (error) return NextResponse.json({ error: 'read mddr: ' + error.message }, { status: 500 })
      for (const r of data) if (r.normalized_document_number) have.add(r.normalized_document_number)
      if (!data || data.length < 1000) break
    }

    // 2) enumerate the ENG2 site libraries
    const siteId = await getSiteId(SITE_URL)
    const listsRes = await graphFetch(`/sites/${siteId}/lists?$select=id,displayName&$top=100`)
    const lists = (await listsRes.json()).value as { id: string; displayName: string }[]

    const rows: any[] = []
    const perLib: Record<string, number> = {}
    let scanned = 0
    const SEL = 'FileLeafRef,FullTitle,FullTitleText,Revision,Status,DocType,Discipline,MainGroup,SubGroup,WBSDescription,DocOwner,FSObjType'
    for (const want of LIBS) {
      const list = lists.find((l) => l.displayName.toUpperCase() === want)
      if (!list) continue
      let url: string | null = `/sites/${siteId}/lists/${list.id}/items?$expand=fields($select=${SEL}),driveItem($select=webUrl,file)&$top=200`
      let libNew = 0
      while (url) {
        const r = await graphFetch(url); const j = await r.json()
        if (!r.ok) return NextResponse.json({ error: `${want} items: ${JSON.stringify(j).slice(0, 200)}` }, { status: 500 })
        for (const it of j.value) {
          const f = it.fields || {}
          if (f.FSObjType === '1' || f.FSObjType === 1) continue           // folder
          const name: string = f.FileLeafRef || ''
          const web: string | undefined = it.driveItem?.webUrl
          if (!name || !web || !it.driveItem?.file) continue               // must be a real file
          scanned++
          const k = norm(name)
          if (!k || have.has(k)) continue                                  // blank or already indexed
          have.add(k)                                                       // guard dupes within this run
          const base = name.replace(/\.[^.]+$/, '')
          const pkg = pkgOf(base)
          rows.push({
            id: uuid5(web),
            source_type: 'INDEX', source_types: ['INDEX'],
            sector: pkg === 'K038' ? 'K038 - Early Works (E&I)' : 'Engineering (ENG2)',
            package_code: pkg,
            document_number: base,
            normalized_document_number: k,
            document_title: f.FullTitle || f.FullTitleText || base,
            document_type: f.DocType || null,
            discipline: f.Discipline || want,
            revision: f.Revision || null,
            document_status: f.Status || null,
            vendor_name: f.DocOwner || 'PPE Technologies',
            file_link: web,
            is_active: true, is_awarded: true,
            raw: { ENG2: { library: want, FullTitle: f.FullTitle, Revision: f.Revision, Status: f.Status, DocType: f.DocType, Discipline: f.Discipline, MainGroup: f.MainGroup, SubGroup: f.SubGroup, WBSDescription: f.WBSDescription } },
          })
          libNew++
        }
        url = (j['@odata.nextLink'] || '').replace('https://graph.microsoft.com/v1.0', '') || null
      }
      perLib[want] = libNew
    }

    if (dry) {
      return NextResponse.json({ ok: true, dry: true, scanned, newDocs: rows.length, perLib,
        sample: rows.slice(0, 5).map((r) => r.document_number) })
    }

    let inserted = 0
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const { error } = await db.from('mddr_entries').upsert(chunk, { onConflict: 'id' })
      if (error) return NextResponse.json({ error: 'upsert: ' + error.message, insertedSoFar: inserted }, { status: 500 })
      inserted += chunk.length
    }
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), scanned, inserted, perLib })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
