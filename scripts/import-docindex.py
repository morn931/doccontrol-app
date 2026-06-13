"""
Import the SharePoint "Document Index" balance into the MDDR.

  python scripts/import-docindex.py           # dry run — prints what WOULD import
  python scripts/import-docindex.py --apply    # write to mddr_entries

A) Docs in a CURRENT MDDR package but not yet imported -> register rows (CDDL/SDDR).
Sectors 1-5) The rest (K038 early works, SHERQ, QC, Plans/Procedures, Specs/Datasheets)
   -> source_type='INDEX' rows with a `sector` label (Document Search only).
Requires migration 006 applied.
"""
import urllib.request, urllib.parse, json, re, collections, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
APPLY = '--apply' in sys.argv

env = {}
for line in open('.env.local', encoding='utf-8'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1); env[k] = v.strip().strip('"')

URL = env['NEXT_PUBLIC_SUPABASE_URL']; KEY = env['SUPABASE_SERVICE_ROLE_KEY']
SH = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}

# ── Graph ──
data = urllib.parse.urlencode({'client_id': env['MICROSOFT_CLIENT_ID'], 'client_secret': env['MICROSOFT_CLIENT_SECRET'],
    'grant_type': 'client_credentials', 'scope': 'https://graph.microsoft.com/.default'}).encode()
tok = json.load(urllib.request.urlopen(urllib.request.Request(
    f"https://login.microsoftonline.com/{env['MICROSOFT_TENANT_ID']}/oauth2/v2.0/token", data=data)))['access_token']
GH = {'Authorization': f'Bearer {tok}'}
def graph(u): return json.load(urllib.request.urlopen(urllib.request.Request(
    u if u.startswith('http') else 'https://graph.microsoft.com/v1.0' + u, headers=GH)))
sid = graph('/sites/ppetechcoza.sharepoint.com:/sites/DocumentControl')['id']
LID = 'e348e9d5-3fb3-45b2-951d-7b299826ce0d'

sel = 'DocNumber,Description,LibraryTitle,Discipline,MainGroup,SubGroup,Status,Company,Sub_Vendor,FileLink,Url,AISummary,AIKeywords,SummaryText,Modified'
rows = []; nxt = 'https://graph.microsoft.com/v1.0' + f"/sites/{sid}/lists/{LID}/items?$expand=fields($select={sel})&$top=999"; pg = 0
while nxt and pg < 120:
    d = graph(nxt); rows += [it['fields'] for it in d['value']]; nxt = d.get('@odata.nextLink'); pg += 1
print(f'Document Index rows: {len(rows)}')

def norm(s):
    if not s: return None
    s = str(s).strip().upper()
    if not s or s in ('-', 'N/A'): return None
    s = re.sub(r'\.[A-Z0-9]{2,4}$', '', s); s = re.sub(r'[_\s]*REV[._\s-]*[A-Z0-9]{1,3}$', '', s)
    s = re.sub(r'_[A-Z0-9]{1,3}$', '', s); s = re.sub(r'\s+', '', s)
    s = re.sub(r'-([A-Z])-([A-Z]{2,4})-', r'-\1\2-', s)
    return s or None
DOCRE = re.compile(r'^6105A([A-Z]\d{3}[A-Z]?)-', re.I)
def pkg_of(dn):
    m = DOCRE.match(dn or ''); return m.group(1).upper() if m else None

# ── existing MDDR keys + current packages ──
mddr = set(); pkgs = set(); frm = 0
while True:
    d = json.load(urllib.request.urlopen(urllib.request.Request(
        f'{URL}/rest/v1/mddr_entries?select=normalized_document_number,package_code&order=id&offset={frm}&limit=1000', headers=SH)))
    for r in d:
        if r['normalized_document_number']: mddr.add(r['normalized_document_number'])
        if r['package_code']: pkgs.add(r['package_code'])
    if len(d) < 1000: break
    frm += 1000

SECT = {1: 'K038 - Early Works (E&I)', 2: 'SHERQ / Safety & HSE', 3: 'QC / Quality',
        4: 'Plans, Procedures & Forms', 5: 'Specifications & Datasheets'}
def classify(r, pkg):
    if pkg == 'K038': return SECT[1]
    t = ' '.join(str(r.get(k) or '') for k in ('LibraryTitle', 'MainGroup', 'SubGroup', 'Description', 'Discipline')).lower()
    if re.search(r'\b(hse|sheq|sherq|safety|h&s|hazop|method statement|commissioning hse)\b', t): return SECT[2]
    if re.search(r'\b(qc|quality|itp|inspection|ndt|weld)\b', t): return SECT[3]
    if re.search(r'\b(plan|procedure|sop|form|governance)\b', t): return SECT[4]
    if re.search(r'specificat|data ?sheet', t): return SECT[5]
    return None

# ── build import rows ──
gap = {}       # normalized -> register row (A)
sector = {}    # normalized -> INDEX row (1-5)
skipped = 0
for r in rows:
    dn = r.get('DocNumber'); k = norm(dn)
    if not k or k in mddr: continue            # blank or already in MDDR
    p = pkg_of(dn)
    ai = r.get('AISummary') or r.get('SummaryText') or r.get('AIKeywords')
    link = r.get('FileLink') or r.get('Url')
    base = dict(document_number=str(dn).strip(), normalized_document_number=k,
                document_title=r.get('Description'), discipline=r.get('Discipline'),
                vendor_name=r.get('Company') or r.get('Sub_Vendor'), ai_text=ai, file_link=link,
                is_awarded=True, is_active=True, raw={'INDEX': {kk: vv for kk, vv in r.items() if not str(kk).startswith('@')}})
    if p in pkgs:                               # A — register gap fill
        base['package_code'] = p
        base['source_type'] = 'CDDL' if p == 'K124' else 'SDDR'
        base['source_types'] = [base['source_type']]
        gap[k] = base
    else:
        s = classify(r, p)
        if not s: skipped += 1; continue
        base['package_code'] = p               # may be None for non-conforming
        base['source_type'] = 'INDEX'; base['sector'] = s; base['source_types'] = ['INDEX']
        sector[k] = base

print(f'\nA) register gap-fill (current packages): {len(gap)}')
for p, c in collections.Counter(v['package_code'] for v in gap.values()).most_common():
    print(f'   {p:8} {c}')
print(f'\nSectors 1-5 (INDEX): {len(sector)}')
for s, c in collections.Counter(v['sector'] for v in sector.values()).most_common():
    print(f'   {s:34} {c}')
print(f'\nskipped (not in sectors 1-5): {skipped}')

if not APPLY:
    print('\nDRY RUN — re-run with --apply to write. (needs migration 006)')
    sys.exit(0)

def upsert(items):
    arr = list(items)
    done = 0
    for i in range(0, len(arr), 200):
        chunk = arr[i:i+200]
        body = json.dumps(chunk).encode()
        req = urllib.request.Request(f'{URL}/rest/v1/mddr_entries',
            data=body, method='POST', headers={**SH, 'Content-Type': 'application/json', 'Prefer': 'return=minimal'})
        try: urllib.request.urlopen(req); done += len(chunk)
        except urllib.error.HTTPError as e: print('  err:', e.code, e.read().decode()[:200])
    return done
print('\nApplying…')
print('  gap inserted:', upsert(gap.values()))
print('  sector inserted:', upsert(sector.values()))
