/* Option C backfill — reconcile mddr_entries.revision to the as-issued (file) rev,
 * moving a forward numeric register rev into target_revision.
 * DRY by default; pass --apply to write. Run AFTER migration 024.
 *   npx tsx scripts/backfill-revisions.ts          # preview
 *   npx tsx scripts/backfill-revisions.ts --apply  # write
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "").trim();
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const APPLY = process.argv.includes("--apply");

const fileRevFromLink = (link?: string | null): string | null => {
  if (!link) return null;
  const m = /_([A-Za-z]{1,2}\d?|\d+)\.[A-Za-z0-9]+(?:$|[?#])/.exec(link);
  return m ? m[1].toUpperCase() : null;
};
const same = (a?: string | null, b?: string | null) => (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();

(async () => {
  let scanned = 0, toFix = 0, applied = 0;
  const byPkg: Record<string, number> = {};
  const samples: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("mddr_entries")
      .select("id, package_code, revision, target_revision, file_link")
      .not("file_link", "is", null)
      .range(from, from + 999);
    if (error) { console.error("scan error:", error.message); break; }
    if (!data?.length) break;
    for (const r of data as any[]) {
      scanned++;
      const fileRev = fileRevFromLink(r.file_link);
      const reg = (r.revision ?? "").trim();
      if (!fileRev || same(fileRev, reg)) continue;
      const patch: Record<string, string | null> = { revision: fileRev };
      if (/^\d+$/.test(reg) && !r.target_revision) patch.target_revision = reg;
      toFix++;
      byPkg[r.package_code ?? "?"] = (byPkg[r.package_code ?? "?"] ?? 0) + 1;
      if (samples.length < 15) samples.push({ pkg: r.package_code, from: reg || "(blank)", to: fileRev, target: patch.target_revision ?? r.target_revision ?? null });
      if (APPLY) {
        const { error: uErr } = await sb.from("mddr_entries").update(patch).eq("id", r.id);
        if (uErr) console.error(`  update ${r.id}: ${uErr.message}`); else applied++;
      }
    }
    if (data.length < 1000) break;
  }
  console.log(`Scanned (rows with a file): ${scanned}`);
  console.log(`Rows needing reconciliation: ${toFix}`);
  console.log("By package:", JSON.stringify(byPkg));
  console.log("Samples (revision from → to, target):"); for (const s of samples) console.log("  " + JSON.stringify(s));
  console.log(APPLY ? `\nAPPLIED: ${applied} rows updated.` : `\nDRY RUN — re-run with --apply to write.`);
})();
