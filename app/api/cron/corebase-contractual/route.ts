import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { getSiteId, graphFetch } from '@/lib/services/graph'

export const runtime = 'nodejs'
export const maxDuration = 120

const SITE_URL = process.env.SHAREPOINT_DOCUMENTCONTROL_SITE_URL || 'https://ppetechcoza.sharepoint.com/sites/DocumentControl'

const uuid5 = (name: string) => {
  const h = createHash('sha1').update('corebase-contractual:' + name).digest()
  const b = Buffer.from(h.subarray(0, 16)); b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80
  const x = b.toString('hex'); return `${x.slice(0,8)}-${x.slice(8,12)}-${x.slice(12,16)}-${x.slice(16,20)}-${x.slice(20,32)}`
}
function mapVendor(v: string, name: string) {
  const t = (v || '').trim(); if (t) { if (/^ABB$/i.test(t)) return 'ABB'; if (/^PPE$/i.test(t)) return 'PPE - Technologies'; return t }
  const n = name.toLowerCase()
  if (/\babb\b|coa|call.?off/.test(n)) return 'ABB'; if (/siemens|^sepk/.test(n)) return 'Siemens'
  if (/crestchic/.test(n)) return 'Crestchic'; if (/fuelco/.test(n)) return 'Fuelco'; if (/orient/.test(n)) return 'Orient'
  if (/\bpsi\b/.test(n)) return 'PSI'; if (/\bppe\b/.test(n)) return 'PPE - Technologies'; return 'Other'
}
function isContractual(name: string, dt: string) {
  const d = (dt || '').toLowerCase(); const nn = name.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ')
  if (/\.msg$/i.test(name)) return false
  if (/invoice|cost ?flow|billing plan|forecast|progress report|s ?curve|monthly report|cash|purchase order status|re baseline|pdnexport|rfiexport|trendexport|pdn b9rd|pcc|gn com|gn let/.test(nn)) return false
  if (/contract|purchase order|notification/.test(d)) return true
  if (/epc contract|framework contract|call off|services agreement|equipment supply|term sheet|force majeure/.test(nn)) return true
  if (/^po \d/.test(nn)) return true
  return false
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  try {
    const siteId = await getSiteId(SITE_URL)
    const listsRes = await graphFetch(`/sites/${siteId}/lists?$select=id,displayName,name`)
    const lists = await listsRes.json()
    const list = (lists.value as any[]).find((l) => /^corebase$/i.test(l.displayName) || /^corebase$/i.test(l.name))
    if (!list) return NextResponse.json({ error: 'CoreBase list not found' }, { status: 404 })

    const records: any[] = []
    let url = `/sites/${siteId}/lists/${list.id}/items?$expand=fields($select=FileLeafRef,Vendor,Doctype,FSObjType),driveItem($select=webUrl,file)&$top=200`
    while (url) {
      const r = await graphFetch(url); const j = await r.json()
      if (!r.ok) return NextResponse.json({ error: `list items: ${JSON.stringify(j).slice(0, 200)}` }, { status: 500 })
      for (const it of j.value) {
        const f = it.fields || {}; if (f.FSObjType === '1') continue
        const name = f.FileLeafRef, web = it.driveItem?.webUrl
        if (!name || !web || !it.driveItem?.file) continue
        if (!isContractual(name, f.Doctype || '')) continue
        const base = name.replace(/\.[^.]+$/, '')
        records.push({
          id: uuid5(web), source_type: 'CoreBase', source_types: ['CoreBase'], sector: 'Contractual',
          vendor_name: mapVendor(f.Vendor || '', name), document_number: base, normalized_document_number: base,
          document_title: base, document_type: 'Contract', file_link: web, is_active: true, is_awarded: true, package_code: null,
        })
      }
      url = (j['@odata.nextLink'] || '').replace('https://graph.microsoft.com/v1.0', '')
    }

    const db: any = createServiceClient()
    const { error } = await db.from('mddr_entries').upsert(records, { onConflict: 'id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const byVendor: Record<string, number> = {}
    for (const r of records) byVendor[r.vendor_name] = (byVendor[r.vendor_name] || 0) + 1
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), upserted: records.length, byVendor })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
