# How CoreDocs (doccontrol-app) deploys — read before you push

> Morné **and** Liezl both have full authority. This is not about permission — it's
> about not overwriting each other's work. Two owners + drifted local clones = the
> "my changes vanished" bug. These rules prevent it.

## The one rule

**`main` is the only thing that reaches production. Nobody runs `vercel --prod` by hand — ever.**

- Push/merge to `main` → GitHub Action **`deploy-prod.yml`** builds on Vercel and deploys production.
- Vercel's own git auto-deploy is **disabled** (`vercel.json` → `git.deploymentEnabled.main = false`).
- Do **not** run `vercel link` / `vercel --prod` — that deploys whatever is on *your* laptop,
  including stale code, over the other owner's work, with no trace in GitHub.

## The git ritual (do this every time)

Before you start working:
```
git checkout main
git pull          # pull the OTHER owner's work FIRST — never start from a stale clone
```

After you finish (or merging a feature branch):
```
git add <your files>     # never `git add -A` (sweeps in .xlsx / .docx / ~$ lock files)
git commit -m "..."
git pull --rebase        # replay your commits on top of anything that landed meanwhile
git push                 # this triggers the production deploy
```

If `git pull` says you're "behind", **stop and pull before doing anything else.**

## Verify after every push

1. GitHub → **Actions** tab → "Deploy to Vercel (Production)" run is **green**.
2. Hard-refresh the **production** URL — `https://doccontrol-app.vercel.app`
   (NOT a `*-<hash>-<team>.vercel.app` **preview** URL).

---
*Same model across Coreflow (CoreTime, CostFlow, coreflow-shell, CoreSHERQ). Keep them aligned.*
