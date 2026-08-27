// Where does the OLD K038 number actually live, and on how many rows?
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue
  const i=t.indexOf('='); const k=t.slice(0,i).trim()
  if(!(k in process.env)) process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')
}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY
const rows=[]
for(let off=0;;off+=1000){
  const r=await fetch(`${URL}/rest/v1/cddl_carryover?select=temp_ref,docno,wbs,legacy_docno,legacy_package,ai_docno,doc_class,target_package,source_path&order=temp_ref&offset=${off}&limit=1000`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}})
  const d=await r.json(); if(!d.length)break; rows.push(...d); if(d.length<1000)break
}
const has=(v)=>!!String(v??'').trim()
const K038=/K038/i
const ready=(r)=>has(r.docno)&&has(r.wbs)
console.log(`rows: ${rows.length}`)
console.log(`legacy_docno populated        : ${rows.filter(r=>has(r.legacy_docno)).length}`)
console.log(`  of which contains K038      : ${rows.filter(r=>K038.test(String(r.legacy_docno??''))).length}`)
console.log(`ai_docno populated            : ${rows.filter(r=>has(r.ai_docno)).length}`)
console.log(`  of which contains K038      : ${rows.filter(r=>K038.test(String(r.ai_docno??''))).length}`)
const anyK038=(r)=>K038.test(String(r.legacy_docno??''))||K038.test(String(r.ai_docno??''))
console.log(`\nrows with a K038 number ANYWHERE: ${rows.filter(anyK038).length}`)
console.log(`  of those, already given a new K124 number: ${rows.filter(r=>anyK038(r)&&has(r.docno)).length}`)
console.log(`  of those, fully ready                     : ${rows.filter(r=>anyK038(r)&&ready(r)).length}`)
console.log(`\nrows READY but with NO K038 number         : ${rows.filter(r=>ready(r)&&!anyK038(r)).length}`)
console.log(`\nsamples (K038 -> new K124):`)
for(const r of rows.filter(r=>anyK038(r)&&has(r.docno)).slice(0,8))
  console.log(`   ${String(r.legacy_docno||r.ai_docno).padEnd(34)} -> ${r.docno}`)
console.log(`\ndisagreements (legacy vs reader, both present and different):`)
const dis=rows.filter(r=>has(r.legacy_docno)&&has(r.ai_docno)&&String(r.legacy_docno).trim().toUpperCase()!==String(r.ai_docno).trim().toUpperCase())
console.log(`   ${dis.length}`)
for(const r of dis.slice(0,5)) console.log(`   filename: ${r.legacy_docno}   |   on document: ${r.ai_docno}`)
