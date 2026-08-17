import fs from 'fs';
const env={};for(const l of fs.readFileSync('.env.local','utf8').split('\n')){const i=l.indexOf('=');if(i<0)continue;env[l.slice(0,i).trim()]=l.slice(i+1).trim().replace(/^["']|["']$/g,'').replace(/\n/g,'').trim();}
const tok=(await (await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:env.MICROSOFT_CLIENT_ID,client_secret:env.MICROSOFT_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default'})})).json()).access_token;
const G=(p,o={})=>fetch(`https://graph.microsoft.com/v1.0${p}`,{...o,headers:{Authorization:`Bearer ${tok}`,'Content-Type':'application/json',...o.headers}});
const url='https://ppetechcoza.sharepoint.com/sites/DocumentControl/K108  Battery Energy Storage System/Manufacturing Clearance.docx';
const shareId='u!'+Buffer.from(url).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const di=await (await G(`/shares/${shareId}/driveItem?$select=id,parentReference`)).json();
const pv=await (await G(`/drives/${di.parentReference.driveId}/items/${di.id}/preview`,{method:'POST',body:JSON.stringify({})})).json();
fs.writeFileSync('/tmp/geturl.txt', pv.getUrl);
console.log(pv.getUrl);
