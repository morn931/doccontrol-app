// What the strip will show right now, so it can be checked without the login gate.
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue
  const i=t.indexOf('='); const k=t.slice(0,i).trim()
  if(!(k in process.env)) process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')
}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY
const rows=[]
for(let off=0;;off+=1000){
  const r=await fetch(`${URL}/rest/v1/cddl_carryover?select=docno,wbs,decided_by,decided_at,ai_has_border,ai_read_at,ai_error&order=temp_ref&offset=${off}&limit=1000`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}})
  const d=await r.json(); if(!d.length)break; rows.push(...d); if(d.length<1000)break
}
const has=(v)=>!!String(v??'').trim(), ready=(r)=>has(r.docno)&&has(r.wbs)
const sast=(t)=>new Date(new Date(t).getTime()+2*3600000).toISOString().slice(0,10)
const dec=rows.filter(r=>has(r.decided_by)&&r.decided_at)
const days={}; for(const r of dec){const d=sast(r.decided_at); days[d]=(days[d]||0)+1}
const entries=Object.entries(days).sort()
const best=entries.reduce((a,b)=>!a||b[1]>a[1]?b:a,null)
const todayKey=sast(new Date())
const done=rows.filter(ready).length, rem=rows.length-done
const mean=dec.length/entries.length, latest=entries[entries.length-1][1]
const pace=Math.max(latest,mean)
let d=new Date(), left=Math.ceil(rem/pace)
while(left>0){d.setUTCDate(d.getUTCDate()+1); const w=d.getUTCDay(); if(w!==0&&w!==6)left--}
console.log(`HEADLINE   ${((done/rows.length)*100).toFixed(1)}%   ${done} of ${rows.length} ready   ${rem} to go`)
console.log(`FINISH BY  ${d.toISOString().slice(0,10)}  (pace ${pace.toFixed(0)}/day)`)
console.log(`TODAY      ${days[todayKey]||0} of ${Math.max(1,best?best[1]:0)}   (best day ${best?best[1]:0} on ${best?best[0]:'—'})`)
console.log(`AVERAGE    ${Math.round(mean)} a day`)
console.log(`PER DAY    ${entries.map(([k,v])=>`${k.slice(5)}:${v}`).join('  ')}`)
const who={}; for(const r of dec) who[r.decided_by]=(who[r.decided_by]||0)+1
console.log(`PLACED     ${Object.entries(who).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k.split('@')[0]} ${v}`).join(' · ')}`)
const rest=rows.filter(r=>!ready(r))
console.log(`SLOWING    ${rest.filter(r=>r.ai_has_border===false).length} no border · ${rest.filter(r=>!r.ai_read_at||has(r.ai_error)).length} unopened`)
