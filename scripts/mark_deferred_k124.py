"""
CoreDocs — flag K124 CDDL deferred scope (RDMC review period)
=============================================================
2026-07-07 finding: the Progress Dashboard's planned-vs-actual gap (26.6% vs
60.4%, -33.9 pts) is dominated by K124's own CDDL — 613 scheduled EPCM
deliverables (site HSE procedures, construction-stage electrical/civil docs)
whose planned dates (May-Oct 2026) reflect the PRE-review-period programme.
With site mobilisation deferred, 350 of the 358 already-due docs sit at 0%.

This marks those docs `is_deferred = true` (migration 012) so the dashboard's
current-basis view excludes them — visibly, with a count. It does NOT touch
planned_completion_date: the original baseline is preserved for the eventual
re-baseline and planned-vs-actual analysis.

Rule (conservative): package K124 · source CDDL · active · awarded ·
has a planned_completion_date · progress_percent <= 0. Anything with recorded
progress stays live. Re-runnable; UNDO=1 clears the flag on the same set.

DRY=1 (default) previews; DRY=0 writes.
"""

import json, os, urllib.request, urllib.error
from collections import Counter

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env.local")
env = {}
for line in open(ENV_PATH, encoding="utf-8"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        # doccontrol .env.local values carry literal backslash-n sequences — strip them
        env[k.strip()] = v.strip().strip('"').strip("'").replace("\\n", "")
URL = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
DRY = os.environ.get("DRY", "1") != "0"
UNDO = os.environ.get("UNDO", "0") == "1"

NOTE = ("Construction-phase / site-mobilisation deliverable - planned date reflects the "
        "pre-review-period programme; deferred pending the revised mobilisation schedule "
        "(flagged 2026-07-07, see Progress Dashboard basis toggle).")


def req(method, path, body=None):
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(URL + "/rest/v1/" + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            t = resp.read()
            return json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def main():
    print(("DRY RUN - no writes" if DRY else "*** WRITING ***") + (" (UNDO mode)" if UNDO else "") + "\n")
    rows = []
    frm = 0
    while True:
        batch = req("GET",
            "mddr_entries?select=id,discipline,progress_percent,planned_completion_date,is_deferred"
            "&is_active=eq.true&is_awarded=eq.true&source_type=eq.CDDL&package_code=eq.K124"
            "&planned_completion_date=not.is.null&progress_percent=lte.0"
            f"&order=id.asc&offset={frm}&limit=1000")
        rows.extend(batch)
        if len(batch) < 1000:
            break
        frm += 1000

    # flag rows not yet flagged; in UNDO mode, unflag rows currently flagged
    targets = [r for r in rows if r["is_deferred"] == UNDO]

    print(f"matching K124 CDDL 0-progress scheduled docs: {len(rows)} | to {'unflag' if UNDO else 'flag'}: {len(targets)}")
    print("by discipline:", dict(Counter((r["discipline"] or "-") for r in targets)))
    print("by due month:", dict(sorted(Counter(r["planned_completion_date"][:7] for r in targets).items())))

    if DRY:
        print("\nDRY run complete - set DRY=0 to write (UNDO=1 to clear the flag).")
        return

    ids = [r["id"] for r in targets]
    for i in range(0, len(ids), 200):
        chunk = ",".join(f'"{x}"' for x in ids[i:i + 200])
        req("PATCH", f"mddr_entries?id=in.({chunk})",
            {"is_deferred": (not UNDO), "deferred_note": (None if UNDO else NOTE)})
    print(f"\n{'Unflagged' if UNDO else 'Flagged'} {len(ids)} docs. Done.")


if __name__ == "__main__":
    main()
