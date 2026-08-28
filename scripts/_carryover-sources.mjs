// What the two sources actually are in the data, so "A" and "B" map onto something real.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue
  const i=t.indexOf('='); const k=t.slice(0,i).trim()
  if(!(k in process.env)) process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')
}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY
const rows=[]
for(let off=0;;off+=1000){
  const r=await fetch(`${URL}/rest/v1/cddl_carryover?select=temp_ref,source,doc_class,target_package,docno,wbs,legacy_docno,source_path&order=temp_ref&offset=${off}&limit=1000`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}})
  const d=await r.json(); if(!d.length)break; rows.push(...d); if(d.length<1000)break
}
const has=(v)=>!!String(v??'').trim(), ready=(r)=>has(r.docno)&&has(r.wbs)
console.log(`total ${rows.length}\n`)
const by={}
for(const r of rows){const k=r.source||'(null)';(by[k]??={n:0,ready:0,pkgs:new Set(),paths:new Set()});by[k].n++;if(ready(r))by[k].ready++;by[k].pkgs.add(r.target_package);if(r.source_path)by[k].paths.add(String(r.source_path).split('/').slice(0,3).join('/'))}
for(const [k,v] of Object.entries(by)){
  console.log(`source = "${k}"`)
  console.log(`   rows ${v.n},  ready ${v.ready}`)
  console.log(`   packages: ${[...v.pkgs].join(' · ')}`)
  console.log(`   example paths: ${[...v.paths].slice(0,2).join('  |  ') || '(none)'}\n`)
}
