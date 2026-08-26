// Human decisions per day. NOT updated_at — the AI reader touched every row when it read
// the documents, so updated_at says nothing about Document Control's progress.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue
  const i=t.indexOf('='); const k=t.slice(0,i).trim()
  if(!(k in process.env)) process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')
}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY
const r=await fetch(`${URL}/rest/v1/cddl_carryover?select=decided_by,decided_at,docno,wbs&decided_at=not.is.null&order=decided_at&limit=2000`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}})
const rows=await r.json()
const has=(v)=>!!String(v??'').trim()
const days={}
for(const x of rows){const d=String(x.decided_at).slice(0,10); (days[d]??={n:0,ready:0}); days[d].n++; if(has(x.docno)&&has(x.wbs))days[d].ready++}
console.log(`rows carrying a human decision: ${rows.length}\n`)
console.log('date         decisions   of which ready')
for(const [d,v] of Object.entries(days).sort()) console.log(`  ${d}   ${String(v.n).padStart(5)}   ${String(v.ready).padStart(9)}`)
const dayKeys=Object.keys(days).sort()
const rate=rows.length/dayKeys.length
console.log(`\naverage ${rate.toFixed(0)} decisions per active day over ${dayKeys.length} days`)
