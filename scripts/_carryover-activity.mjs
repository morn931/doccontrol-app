// Clustered activity from decided_at. ⚠️ This measures WHEN DECISIONS WERE SAVED, not
// effort: opening a drawing, reading its title block and checking the MDDR all happen
// between saves and are invisible here.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue
  const i=t.indexOf('='); const k=t.slice(0,i).trim()
  if(!(k in process.env)) process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')
}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY
const r=await fetch(`${URL}/rest/v1/cddl_carryover?select=decided_by,decided_at&decided_at=not.is.null&order=decided_at&limit=2000`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}})
const rows=await r.json()
const GAP=30*60*1000  // a gap over 30 min ends a working session
const byPerson={}
for(const x of rows){(byPerson[x.decided_by]??=[]).push(new Date(x.decided_at).getTime())}
console.log(`GAP threshold ${GAP/60000} min.  "active" = time bracketed by consecutive saves.\n`)
for(const [who,tsAll] of Object.entries(byPerson)){
  const ts=tsAll.sort((a,b)=>a-b)
  const byDay={}
  for(const t of ts){const d=new Date(t).toISOString().slice(0,10);(byDay[d]??=[]).push(t)}
  console.log(`${who}`)
  let totActive=0
  for(const [d,list] of Object.entries(byDay).sort()){
    let active=0, sessions=1
    for(let i=1;i<list.length;i++){const g=list[i]-list[i-1]; if(g<=GAP) active+=g; else sessions++}
    totActive+=active
    const span=(list[list.length-1]-list[0])/60000
    const t0=new Date(list[0]).toISOString().slice(11,16), t1=new Date(list[list.length-1]).toISOString().slice(11,16)
    console.log(`   ${d}  ${String(list.length).padStart(3)} saves  first ${t0} last ${t1} UTC  span ${span.toFixed(0).padStart(4)}m  active ${(active/60000).toFixed(0).padStart(4)}m  sessions ${sessions}`)
  }
  console.log(`   TOTAL active ${(totActive/3600000).toFixed(2)} h over ${Object.keys(byDay).length} day(s), ${ts.length} decisions\n`)
}
// median seconds between consecutive saves within a session — the honest "per document" figure
const gaps=[]
for(const ts of Object.values(byPerson)){const s=ts.sort((a,b)=>a-b); for(let i=1;i<s.length;i++){const g=s[i]-s[i-1]; if(g<=GAP)gaps.push(g)}}
gaps.sort((a,b)=>a-b)
console.log(`within-session gap between saves: median ${(gaps[Math.floor(gaps.length/2)]/1000).toFixed(0)}s, n=${gaps.length}`)
