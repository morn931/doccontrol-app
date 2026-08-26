// How far Document Control has got on the CDDL Carry-over, using the app's OWN rule
// for done: isReady = docno && wbs (lib/carryover/types.ts). Anything else would be a
// different number from the one on the page.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue
  const i=t.indexOf('='); const k=t.slice(0,i).trim()
  if(!(k in process.env)) process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')
}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY
const H={apikey:KEY,Authorization:`Bearer ${KEY}`}
const rows=[]
for(let off=0;;off+=1000){
  const r=await fetch(`${URL}/rest/v1/cddl_carryover?select=temp_ref,docno,wbs,area_facility,discipline,doc_type,title,major_desc,broad_type,revision,ai_has_border,ai_error,ai_read_at,decided_by,decided_at,updated_at,created_at,target_package,doc_class,source_files&order=temp_ref&offset=${off}&limit=1000`,{headers:H})
  const d=await r.json(); if(!Array.isArray(d)){console.log(d);process.exit(1)}
  if(!d.length)break; rows.push(...d); if(d.length<1000)break
}
const has=(v)=>!!String(v??'').trim()
const ready=(r)=>has(r.docno)&&has(r.wbs)
const pct=(n,d)=>d?((n/d)*100).toFixed(1)+'%':'—'
const N=rows.length
const done=rows.filter(ready)
const partial=rows.filter(r=>!ready(r)&&(has(r.docno)||has(r.wbs)))
const untouched=rows.filter(r=>!has(r.docno)&&!has(r.wbs))

console.log(`CDDL CARRY-OVER — ${N} documents\n`)
console.log(`  READY (number + area)   ${String(done.length).padStart(4)}   ${pct(done.length,N).padStart(6)}   <- exportable now`)
console.log(`  part done (one of two)  ${String(partial.length).padStart(4)}   ${pct(partial.length,N).padStart(6)}`)
console.log(`  not started             ${String(untouched.length).padStart(4)}   ${pct(untouched.length,N).padStart(6)}`)
console.log(`\n  number allocated        ${String(rows.filter(r=>has(r.docno)).length).padStart(4)}   ${pct(rows.filter(r=>has(r.docno)).length,N).padStart(6)}`)
console.log(`  area allocated          ${String(rows.filter(r=>has(r.wbs)).length).padStart(4)}   ${pct(rows.filter(r=>has(r.wbs)).length,N).padStart(6)}`)

console.log(`\nBY PACKAGE`)
const byPkg={}
for(const r of rows){const k=r.target_package||'(none)';(byPkg[k]??={n:0,d:0});byPkg[k].n++;if(ready(r))byPkg[k].d++}
for(const [k,v] of Object.entries(byPkg).sort((a,b)=>b[1].n-a[1].n))
  console.log(`  ${String(v.d).padStart(4)}/${String(v.n).padEnd(4)} ${pct(v.d,v.n).padStart(7)}  ${k}`)

console.log(`\nWHO HAS BEEN WORKING ON IT`)
const byWho={}
for(const r of rows) if(has(r.decided_by)) (byWho[r.decided_by]??=[]).push(r.decided_at||r.updated_at)
if(!Object.keys(byWho).length) console.log('  no decided_by recorded on any row')
for(const [k,v] of Object.entries(byWho).sort((a,b)=>b[1].length-a[1].length)){
  const ts=v.filter(Boolean).sort()
  console.log(`  ${String(v.length).padStart(4)}  ${k}   first ${String(ts[0]).slice(0,16).replace('T',' ')}   last ${String(ts[ts.length-1]).slice(0,16).replace('T',' ')}`)
}
const edited=rows.filter(r=>r.updated_at&&r.created_at&&r.updated_at!==r.created_at)
console.log(`\n  rows touched since load: ${edited.length}  (${pct(edited.length,N)})`)
const days={}
for(const r of edited) { const d=String(r.updated_at).slice(0,10); days[d]=(days[d]||0)+1 }
console.log(`  activity by day:`)
for(const [d,n] of Object.entries(days).sort()) console.log(`     ${d}  ${String(n).padStart(4)}`)

console.log(`\nBLOCKERS ON THE REMAINING ${N-done.length}`)
const rest=rows.filter(r=>!ready(r))
console.log(`  no project border (ai_has_border=false) : ${rest.filter(r=>r.ai_has_border===false).length}`)
console.log(`  never opened / read error               : ${rest.filter(r=>!r.ai_read_at||has(r.ai_error)).length}`)
