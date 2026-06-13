"""Backfill mddr_entries.file_link for register docs from the Document Index
(actual file URL) and document_versions.central_file_url (fallback).
  python scripts/backfill-filelinks.py            # dry run
  python scripts/backfill-filelinks.py --apply
"""
import urllib.request, urllib.parse, json, re, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
APPLY = '--apply' in sys.argv
env = {}
for line in open('.env.local', encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1); env[k] = v.strip().strip('"')
URL = env['NEXT_PUBLIC_SUPABASE_URL']; KEY = env['SUPABASE_SERVICE_ROLE_KEY']
SH = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}

def norm(s):
    if not s: return None
    s = str(s).strip().upper()
    if not s or s in ('-', 'N/A'): return None
    s = re.sub(r'\.[A-Z0-9]{2,4}$', '', s); s = re.sub(r'[_\s]*REV[._\s-]*[A-Z0-9]{1,3}$', '', s)
    s = re.sub(r'_[A-Z0-9]{1,3}$', '', s); s = re.sub(r'\s+', '', s)
    s = re.sub(r'-([A-Z])-([A-Z]{2,4})-', r'-\1\2-', s)
    return s or None

# url map: normalized -> (url, modified)  — prefer the most recently modified
umap = {}
def put(k, u, mod):
    if not k or not u: return
    if k not in umap or (mod or '') > (umap[k][1] or ''):
        umap[k] = (u, mod)

# Document Index (actual file URLs)
data = urllib.parse.urlencode({'client_id': env['MICROSOFT_CLIENT_ID'], 'client_secret': env['MICROSOFT_CLIENT_SECRET'],
    'grant_type': 'client_credentials', 'scope': 'https://graph.microsoft.com/.default'}).encode()
tok = json.load(urllib.request.urlopen(urllib.request.Request(
    f"https://login.microsoftonline.com/{env['MICROSOFT_TENANT_ID']}/oauth2/v2.0/token", data=data)))['access_token']
GH = {'Authorization': f'Bearer {tok}'}
sid = json.load(urllib.request.urlopen(urllib.request.Request('https://graph.microsoft.com/v1.0/sites/ppetechcoza.sharepoint.com:/sites/DocumentControl', headers=GH)))['id']
nxt = f'https://graph.microsoft.com/v1.0/sites/{sid}/lists/e348e9d5-3fb3-45b2-951d-7b299826ce0d/items?$expand=fields($select=DocNumber,FileLink,Url,Modified)&$top=999'
idx = 0
while nxt:
    d = json.load(urllib.request.urlopen(urllib.request.Request(nxt, headers=GH)))
    for it in d['value']:
        f = it['fields']; put(norm(f.get('DocNumber')), f.get('FileLink') or f.get('Url'), f.get('Modified')); idx += 1
    nxt = d.get('@odata.nextLink')
print('Document Index files scanned:', idx, '| distinct url keys:', len(umap))

# document_versions central_file_url (fallback)
frm = 0; dv = 0
while True:
    d = json.load(urllib.request.urlopen(urllib.request.Request(
        f'{URL}/rest/v1/document_versions?select=file_name,central_file_url,reviewed_file_url,uploaded_at&order=id&offset={frm}&limit=1000', headers=SH)))
    for r in d:
        k = norm(r['file_name']); u = r.get('central_file_url') or r.get('reviewed_file_url')
        if k and u and k not in umap: umap[k] = (u, r.get('uploaded_at')); dv += 1
    if len(d) < 1000: break
    frm += 1000
print('added from document_versions:', dv, '| total url keys:', len(umap))

# Only look up mddr rows whose doc number actually has a URL (keyed, no deep offset).
keys = [k for k in umap.keys() if k.isascii()]   # project doc numbers are ASCII
updates = []
for i in range(0, len(keys), 150):
    chunk = keys[i:i+150]
    lst = '(' + ','.join('"' + k.replace('"', '') + '"' for k in chunk) + ')'
    q = f'{URL}/rest/v1/mddr_entries?select=id,source_type,normalized_document_number&file_link=is.null&normalized_document_number=in.{lst}'
    try:
        d = json.load(urllib.request.urlopen(urllib.request.Request(q, headers=SH)))
    except urllib.error.HTTPError as e:
        print('  select err', e.code); continue
    for r in d:
        updates.append({'id': r['id'], 'source_type': r['source_type'], 'file_link': umap[r['normalized_document_number']][0]})
print(f'mddr rows that can be filled: {len(updates)}')

if not APPLY:
    print('DRY RUN — re-run with --apply'); sys.exit(0)
done = 0
for i in range(0, len(updates), 100):
    chunk = updates[i:i+100]
    req = urllib.request.Request(f'{URL}/rest/v1/mddr_entries?on_conflict=id', data=json.dumps(chunk).encode(), method='POST',
        headers={**SH, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'})
    try: urllib.request.urlopen(req); done += len(chunk)
    except urllib.error.HTTPError as e: print('  err', e.code, e.read().decode()[:150])
print('filled:', done)
