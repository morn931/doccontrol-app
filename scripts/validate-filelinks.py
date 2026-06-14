"""Validate (and repair) mddr_entries.file_link against SharePoint via Graph.
  python scripts/validate-filelinks.py            # dry run — reports valid/repaired/dead
  python scripts/validate-filelinks.py --apply     # update repaired links; null dead ones

For each link: confirm it resolves; if gone, look in the parent folder for the same
document number (any revision) and repair the link; if still nothing, mark it dead
(null) so the Open button hides.
"""
import urllib.request, urllib.parse, json, base64, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
APPLY = '--apply' in sys.argv
env = {}
for line in open('.env.local', encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1); env[k] = v.strip().strip('"')
URL = env['NEXT_PUBLIC_SUPABASE_URL']; KEY = env['SUPABASE_SERVICE_ROLE_KEY']
SH = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
data = urllib.parse.urlencode({'client_id': env['MICROSOFT_CLIENT_ID'], 'client_secret': env['MICROSOFT_CLIENT_SECRET'],
    'grant_type': 'client_credentials', 'scope': 'https://graph.microsoft.com/.default'}).encode()
tok = json.load(urllib.request.urlopen(urllib.request.Request(
    f"https://login.microsoftonline.com/{env['MICROSOFT_TENANT_ID']}/oauth2/v2.0/token", data=data)))['access_token']
GH = {'Authorization': f'Bearer {tok}'}

def graph(path):
    try:
        return json.load(urllib.request.urlopen(urllib.request.Request('https://graph.microsoft.com/v1.0' + path, headers=GH)))
    except urllib.error.HTTPError:
        return None

def share_id(url):
    b = base64.b64encode(url.encode()).decode().rstrip('=').replace('/', '_').replace('+', '-')
    return 'u!' + b

def resolve(url, core):
    di = graph(f'/shares/{share_id(url)}/driveItem?$select=id,webUrl,parentReference')
    if di and di.get('webUrl'):
        return di['webUrl'], False        # valid as-is
    slash = url.rfind('/')
    if slash < 0 or not core: return None, False
    pf = graph(f'/shares/{share_id(url[:slash])}/driveItem?$select=id,parentReference')
    drv = (pf or {}).get('parentReference', {}).get('driveId')
    if not pf or not pf.get('id') or not drv: return None, False
    ch = graph(f"/drives/{drv}/items/{pf['id']}/children?$select=name,webUrl&$top=400")
    kids = (ch or {}).get('value', []) if ch else []
    m = [k for k in kids if (k.get('name') or '').upper().startswith(core.upper())]
    if not m: return None, False
    m.sort(key=lambda k: k.get('name') or '', reverse=True)
    return m[0].get('webUrl'), True         # repaired

# pull rows with a file_link
rows = []; frm = 0
while True:
    d = json.load(urllib.request.urlopen(urllib.request.Request(
        f'{URL}/rest/v1/mddr_entries?select=id,source_type,file_link,normalized_document_number,document_number&file_link=not.is.null&order=id&offset={frm}&limit=1000', headers=SH)))
    rows += d
    if len(d) < 1000: break
    frm += 1000
print(f'links to validate: {len(rows)}')

valid = repaired = dead = 0
updates = []
for i, r in enumerate(rows):
    core = r['normalized_document_number'] or r['document_number']
    web, fixed = resolve(r['file_link'], core)
    if web and not fixed: valid += 1
    elif web and fixed:
        repaired += 1; updates.append({'id': r['id'], 'source_type': r['source_type'], 'file_link': web})
    else:
        dead += 1; updates.append({'id': r['id'], 'source_type': r['source_type'], 'file_link': None})
    if (i + 1) % 200 == 0: print(f'  {i+1}/{len(rows)}  valid {valid} repaired {repaired} dead {dead}')
print(f'\nvalid {valid} | repaired {repaired} | dead {dead}')

if not APPLY:
    print('DRY RUN — re-run with --apply to write repairs + null dead links'); sys.exit(0)
done = 0
for i in range(0, len(updates), 100):
    chunk = updates[i:i+100]
    req = urllib.request.Request(f'{URL}/rest/v1/mddr_entries?on_conflict=id', data=json.dumps(chunk).encode(), method='POST',
        headers={**SH, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal'})
    try: urllib.request.urlopen(req); done += len(chunk)
    except urllib.error.HTTPError as e: print('  err', e.code, e.read().decode()[:150])
print('written:', done)
