import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('='))continue
  const i=t.indexOf('='); const k=t.slice(0,i).trim()
  if(!(k in process.env)) process.env[k]=t.slice(i+1).trim().replace(/^["']|["']$/g,'')
}
const URL=process.env.NEXT_PUBLIC_SUPABASE_URL, KEY=process.env.SUPABASE_SERVICE_ROLE_KEY
const refs=['CO-132','CO-139','CO-140','CO-142','CO-146','CO-147','CO-148','CO-149','CO-152','CO-154']
const r=await fetch(`${URL}/rest/v1/cddl_carryover?select=temp_ref,ai_has_border,docno,ai_docno,legacy_docno,ai_title,doc_class&temp_ref=in.(${refs.join(',')})&order=temp_ref`,{headers:{apikey:KEY,Authorization:`Bearer ${KEY}`}})
const rows=await r.json()
const S=(v)=>String(v??'').trim()
console.log('ref     border  docno            ai_docno                        legacy_docno')
for(const x of rows)
  console.log(`${x.temp_ref}  ${String(x.ai_has_border).padEnd(6)}  ${S(x.docno).padEnd(16)} ${S(x.ai_docno).slice(0,30).padEnd(31)} ${S(x.legacy_docno)}`)
