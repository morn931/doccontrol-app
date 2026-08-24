"""
Seed public.cddl_carryover from the tender transfer folder.

Lives here with the register and the reader (read-carryover.ts) rather than in
CoreReports, so all the carry-over tooling has one home.

EVERY file in the folder is accounted for — nothing is judged irrelevant here. Files are
grouped into DOCUMENTS (a document's revisions and its native/published pair are one row),
and every file that fed a row is listed in `source_files`, so the 384 files reconcile
exactly to the rows written. The seeder asserts that before it writes.

Only provenance is seeded. The `ai_*` columns are filled by read_carryover.py, and the
decision columns are left EMPTY for document control — a suggestion is shown beside the
field in the register, never written into it, so an extracted value can never be mistaken
for an approved one.

Re-runnable: a document is identified by `source_path`, and a temp_ref once assigned is
never reused or renumbered, so links stay stable as the folder changes.

    python scripts/seed_carryover.py            # dry run
    python scripts/seed_carryover.py --apply
"""
import collections
import json
import os
import re
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_FILES = [os.path.join(HERE, "..", ".env.local")]
JARROD_DIR = r"C:\Users\mornec\OneDrive - PPE Technologies\Company Docs\Jarrod add to CDDL K124"

DOCNO = re.compile(r"6105A([A-Z]?\d{3}[A-Z]?)-(\d{4})-([A-Z0-9]{4})-([0-9X]{4})", re.I)
norm = lambda s: re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def load_env(path):
    out = {}
    if not os.path.exists(path):
        return out
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'").replace("\\n", "").strip()
        if v:
            out[k.strip()] = v
    return out


ENV = {}
for f in ENV_FILES:
    ENV.update(load_env(f))
# CoreDocs reads its own project, so these are the plain names, not COREDOCS_*.
URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or ENV.get("NEXT_PUBLIC_SUPABASE_URL")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ENV.get("SUPABASE_SERVICE_ROLE_KEY")
if not (URL and KEY):
    sys.exit("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}


def rest(path, method="GET", body=None, extra=None):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={**H, **(extra or {})})
    raw = urllib.request.urlopen(req, timeout=180).read()
    return json.loads(raw) if raw else []


def stem(name):
    """Collapse the file-name variants of ONE document — revision suffixes, trailing dates,
    "(1)" copies, annotation tails and the native/published .docx+.pdf pair."""
    s = os.path.splitext(name)[0]
    s = re.sub(r"[_\- ]+(rev\s*)?[A-Z]?\d{0,2}$", "", s, flags=re.I)
    s = re.sub(r"[_\- ]\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$", "", s)
    s = re.sub(r"\s*\(\d+\)$", "", s)
    s = re.sub(r"[_\- ](vendor scope|vendor latest|hsdg_vendor scope|d-jorge)$", "", s, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", s.lower())


CLASS = [(r"data ?sheet", "Data Sheet"), (r"drawing", "Drawing"), (r"calculation", "Calculation"),
         (r"manual", "Manual"), (r"fat procedure", "FAT Procedure"), (r"document", "Document"),
         (r"commercial", "Commercial / Tender")]


def classify(sub, fn):
    for pat, label in CLASS:
        if re.search(pat, sub, re.I):
            return label
    n = fn.lower()
    if n.endswith((".xlsx", ".xlsm", ".xls")):
        return "Calculation / Schedule"
    if n.endswith((".docx", ".doc")):
        return "Document"
    if n.endswith((".jpg", ".jpeg", ".png")):
        return "Image"
    return "Document"


def scan():
    docs, n_files = collections.OrderedDict(), 0
    for root, _d, files in os.walk(JARROD_DIR):
        for fn in sorted(files):
            n_files += 1
            full = os.path.join(root, fn)
            rel = os.path.relpath(full, JARROD_DIR).replace("\\", "/")
            parts = rel.split("/")
            pkg, folder, sub = parts[0], "/".join(parts[:-1]), "/".join(parts[1:-1])
            m = DOCNO.search(fn)
            key = ("N", m.group(0).upper()) if m else ("U", folder, stem(fn))
            d = docs.setdefault(key, {
                "legacy": m.group(0).upper() if m else None,
                "legacy_pkg": m.group(1).upper() if m else None,
                "legacy_area": m.group(2) if m else None,
                "target_package": pkg, "transfer_subfolder": sub,
                "files": [], "bytes": 0, "first": fn,
                # canonical identity: the folder + the first file, stable while the file exists
                "source_path": rel,
            })
            d["files"].append(rel)
            try:
                d["bytes"] += os.path.getsize(full)
            except OSError:
                pass
    for d in docs.values():
        d["doc_class"] = classify(d["transfer_subfolder"], d["first"])
        # prefer a PDF as the canonical file — it is what the reader and the viewer open
        pdfs = [f for f in d["files"] if f.lower().endswith(".pdf")]
        d["source_path"] = sorted(pdfs or d["files"])[0]
    return docs, n_files


def main():
    apply = "--apply" in sys.argv
    docs, n_files = scan()
    covered = sum(len(d["files"]) for d in docs.values())
    print(f"transfer folder: {n_files} files -> {len(docs)} documents")
    # Nothing may be silently dropped: every file must belong to exactly one row.
    assert covered == n_files, f"file reconciliation FAILED: {covered} covered vs {n_files} found"
    print(f"  reconciliation OK — all {n_files} files are attached to a row")

    existing = {r["source_path"]: r for r in rest("cddl_carryover?select=temp_ref,source_path&limit=5000")}
    used = {r["temp_ref"] for r in existing.values()}
    print(f"  already in the register: {len(existing)}")

    # enrichment: only to show WHAT WE KNOW, never written into a decision column
    cddl = {}
    off = 0
    while True:
        page = rest(f"cddl_doc?select=docno,title,area_facility,broad_type,aconex_doc_status,"
                    f"doc_owner,discipline,doc_type,revision,retired&order=docno&offset={off}&limit=1000")
        if not page:
            break
        for r in page:
            if not r.get("retired"):
                cddl[norm(r.get("docno"))] = r
        if len(page) < 1000:
            break
        off += 1000
    print(f"  live CDDL records for cross-reference: {len(cddl)}")

    def next_ref():
        n = 1
        while f"CO-{n:03d}" in used:
            n += 1
        used.add(f"CO-{n:03d}")
        return f"CO-{n:03d}"

    rows, new = [], 0
    for _k, d in sorted(docs.items(), key=lambda kv: (kv[1]["target_package"], kv[1]["source_path"])):
        prev = existing.get(d["source_path"])
        ref = prev["temp_ref"] if prev else next_ref()
        if not prev:
            new += 1
        rows.append({
            "temp_ref": ref,
            "source_path": d["source_path"],
            "source_files": d["files"],
            "target_package": d["target_package"],
            "transfer_subfolder": d["transfer_subfolder"] or None,
            "doc_class": d["doc_class"],
            "legacy_docno": d["legacy"],
            "legacy_package": d["legacy_pkg"],
            "legacy_area": d["legacy_area"],
            "file_bytes": d["bytes"],
        })

    pk = collections.Counter(r["legacy_package"] or "(never numbered)" for r in rows)
    print(f"\n  {len(rows)} rows ({new} new, {len(rows) - new} already present)")
    for k, v in pk.most_common():
        print(f"    {str(v).rjust(4)}  {k}")
    known = sum(1 for r in rows if r["legacy_docno"] and norm(r["legacy_docno"]) in cddl)
    print(f"  cross-referenced to a live CDDL record: {known}")

    if not apply:
        print("\n  (dry run — nothing written. Re-run with --apply)")
        return

    for i in range(0, len(rows), 100):
        rest("cddl_carryover?on_conflict=temp_ref", "POST", rows[i:i + 100],
             {"Prefer": "resolution=merge-duplicates,return=minimal"})
        print(f"\r  written {min(i + 100, len(rows))}/{len(rows)}", end="")
    total = rest("cddl_carryover?select=temp_ref&limit=5000")
    print(f"\n  done — {len(total)} rows in the register")


if __name__ == "__main__":
    main()
