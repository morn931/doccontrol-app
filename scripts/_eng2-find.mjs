// Find files by name in the ENG2 B-list batch folders. usage: node scripts/_eng2-find.mjs name1 name2 ...
import fs from 'node:fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) { const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue; const i = t.indexOf('='); const k = t.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '') }
const tok = (await (await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }) })).json()).access_token
const H = { Authorization: `Bearer ${tok}` }, G = 'https://graph.microsoft.com/v1.0'
const get = async (u) => (await fetch(G + u, { headers: H })).json()
const want = process.argv.slice(2).map(s => s.toLowerCase())
const site = await get('/sites/ppetechcoza.sharepoint.com:/sites/ENG2')
for (const dr of (await get(`/sites/${site.id}/drives?$select=id,name`)).value ?? []) {
  for (const b of ((await get(`/drives/${dr.id}/root/children?$top=999&$select=id,name,folder`)).value ?? []).filter(k => k.folder && /K038 Carry-over|Recovered from Aconex/.test(k.name))) {
    const walk = async (id, p) => { for (const c of (await get(`/drives/${dr.id}/items/${id}/children?$top=999&$select=id,name,folder`)).value ?? []) { if (c.folder) await walk(c.id, `${p}/${c.name}`); else if (!want.length || want.includes(c.name.toLowerCase())) console.log(`${dr.name}/${p}/${c.name}`) } }
    await walk(b.id, b.name)
  }
}
