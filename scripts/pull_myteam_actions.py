#!/usr/bin/env python3
"""
Pull recent AI-extracted action items from "My Team's Actions" (coreflow_action_item,
CoreTime Supabase) into the CoreDocs Engineering Action Register as STAGED SUGGESTIONS
(suggested=true) for the identified engineering team. The EM confirms/dismisses them in
the register's "AI-suggested" lane. Idempotent via source_ref = coreflow_action_item.id.

  DAYS=10 DRY=1 python scripts/pull_myteam_actions.py   # preview (default)
  DAYS=10 DRY=0 python scripts/pull_myteam_actions.py   # write suggestions

Slice B (agreed): is_engineering CoreDocs roles (reviewer + engineering_manager) PLUS the
8 obvious engineers who hold developer/other roles. Excludes externals, unresolved imports,
admin/doc-control, and status 'done'.
"""
import os, sys, json, re, urllib.request, urllib.parse, urllib.error, datetime
from collections import Counter
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

DAYS = int(os.environ.get('DAYS', '10'))
DRY = os.environ.get('DRY', '1') != '0'
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def load_env(path):
    e = {}
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1); e[k.strip()] = v.strip().strip('"')
    return e

DOCS = load_env(os.path.join(HERE, '.env.local'))
CT   = load_env(r'C:\Users\mornec\Claude\Projects\CostFLow management\costflow-app\.env.local')
CT_URL = 'https://ssyvxiqlcxfqomdklakr.supabase.co'; CT_KEY = re.sub(r'\s', '', CT['SUPABASE_SERVICE_ROLE_KEY'])
DOCS_URL = 'https://tjzeahdimbekuizegsky.supabase.co'; DOCS_KEY = re.sub(r'\s', '', DOCS['SUPABASE_SERVICE_ROLE_KEY'])

def req(url, key, method='GET', body=None, prefer=None):
    h = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    if prefer: h['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=45) as resp:
            t = resp.read().decode(); return (json.loads(t) if t else None), None
    except urllib.error.HTTPError as e:
        return None, f'{e.code}:{e.read().decode()[:200]}'

def docs_get(path, params):
    q = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    d, err = req(f'{DOCS_URL}/rest/v1/{path}?{q}', DOCS_KEY)
    if err: raise SystemExit('CoreDocs read failed: ' + err)
    return d

# 1) Engineering team = is_engineering roles + the 8 named.
eng_roles = [r['role'] for r in docs_get('role_definitions', {'select': 'role', 'is_engineering': 'eq.true'})]
eng_users = docs_get('users', {'select': 'email,full_name', 'role': f"in.({','.join(eng_roles)})", 'limit': '1000'})
name_by = {u['email'].lower(): u.get('full_name') for u in eng_users if u.get('email')}
# The 8 named engineers hold developer/other roles OR aren't CoreDocs users at all — add by
# email directly so they're not dropped (Slice B, per Morné).
EXTRA = ['mornec', 'jarrodm', 'stephend', 'christol', 'leeroyp', 'johanv', 'jans', 'johanm']
extra_emails = {f'{u}@ppetech.co.za' for u in EXTRA}
for u in docs_get('users', {'select': 'email,full_name', 'limit': '2000'}):
    if u.get('email') and u['email'].lower() in extra_emails: name_by[u['email'].lower()] = u.get('full_name')
team = set(name_by.keys()) | extra_emails
def clean_name(s):  # coreflow assignee_name can carry mojibake — keep only sane names
    s = (s or '').strip()
    return s if s and re.fullmatch(r"[A-Za-z .'\-]+", s) else None
print(f'Engineering team: {len(team)} people ({len(eng_roles)} is_engineering roles + {len(EXTRA)} named)')

# 2) Read the last-N-days AI items (CoreTime).
cut = (datetime.datetime.utcnow() - datetime.timedelta(days=DAYS)).isoformat()
q = urllib.parse.urlencode({'select': 'id,task,assignee_name,assignee_email,is_external,status,source_type,source_title,source_date',
                            'created_at': f'gte.{cut}', 'limit': '5000'}, quote_via=urllib.parse.quote)
rows, err = req(f'{CT_URL}/rest/v1/coreflow_action_item?{q}', CT_KEY)
if err: raise SystemExit('CoreTime read failed: ' + err)

def keep(r):
    e = (r.get('assignee_email') or '').lower()
    return (not r.get('is_external')) and e in team and r['status'] in ('suggested', 'open') and (r.get('task') or '').strip()
cand = [r for r in rows if keep(r)]

# 3) Dedup against what's already pulled (source_ref).
existing = set()
for i in range(0, len(cand), 100):
    ids = ','.join(f'"{r["id"]}"' for r in cand[i:i+100])
    got = docs_get('engineering_action', {'select': 'source_ref', 'source_ref': f'in.({ids})'})
    existing |= {g['source_ref'] for g in got if g.get('source_ref')}
new = [r for r in cand if r['id'] not in existing]
def nm(r): return name_by.get(r['assignee_email'].lower()) or clean_name(r.get('assignee_name')) or r['assignee_email'].split('@')[0]

print(f'Last {DAYS}d rows: {len(rows)} · engineering candidates: {len(cand)} · already pulled: {len(existing)} · NEW: {len(new)}')
print('  by source:', dict(Counter(r['source_type'] for r in new)))
print('  by person:', dict(Counter(nm(r) for r in new).most_common(14)))

if DRY:
    print('\nsample:')
    for r in new[:6]:
        print(f"  [{r['source_type']}] {nm(r)} · {str(r['task'])[:70]}")
    print('\nDRY run — nothing written. Re-run with DRY=0 to stage these as suggestions.')
    sys.exit(0)

# 4) Write as staged suggestions.
def src(t): return 'email' if t == 'email' else 'meeting'
body = [{
    'description': (r['task'] or '').strip()[:2000],
    'title': (r['task'] or '').strip()[:80],
    'assigned_to_email': r['assignee_email'].lower(),
    'assigned_to_name': nm(r),
    'raised_by_email': 'ai-scan@coreflow.build', 'raised_by_name': 'AI scan · My Team Actions',
    'source': src(r['source_type']), 'source_ref': r['id'], 'suggested': True, 'status': 'open',
    'area_system': (r.get('source_title') or None),
} for r in new]
wrote = 0
for i in range(0, len(body), 200):
    _, err = req(f'{DOCS_URL}/rest/v1/engineering_action', DOCS_KEY, 'POST', body[i:i+200], 'return=minimal')
    if err: print('WRITE FAILED:', err); sys.exit(1)
    wrote += len(body[i:i+200])
print(f'\nStaged {wrote} AI-suggested actions (suggested=true). Review them in the register "AI-suggested" lane.')
