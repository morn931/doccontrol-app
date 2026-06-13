/**
 * P6 Activity-ID progress export.
 *
 * The planner updates Physical % Complete per P6 Activity ID. Many MDDR documents
 * map to one Activity ID (the UP-link to the master P6), so this rolls the
 * document-level Rules-of-Credit progress up to a single % per activity:
 *   activity % complete = average of its documents' progress_percent.
 *
 * Output is keyed by Activity ID and is ready to paste/import into P6.
 */

export interface P6Activity {
  activityId:    string
  docCount:      number
  completedDocs: number   // docs at 100%
  avgProgressPct: number  // 0..1 (the activity % complete)
  packages:      string[]
}

export interface P6ExportResult {
  rows:  P6Activity[]
  total: { activities: number; docCount: number; avgProgressPct: number }
}

export async function aggregateByActivity(db: any, opts: { package?: string } = {}): Promise<P6ExportResult> {
  type Acc = { count: number; completed: number; sum: number; packages: Set<string> }
  const acc: Record<string, Acc> = {}

  for (let from = 0; ; from += 1000) {
    let q = db.from('mddr_entries')
      .select('activity_id, progress_percent, package_code')
      .eq('is_active', true).eq('is_awarded', true)
      .not('activity_id', 'is', null)
      .order('id', { ascending: true }).range(from, from + 999)
    if (opts.package) q = q.eq('package_code', opts.package)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const id = (r.activity_id ?? '').trim()
      if (!id) continue
      const a = (acc[id] ??= { count: 0, completed: 0, sum: 0, packages: new Set() })
      const p = Number(r.progress_percent ?? 0)
      a.count++; a.sum += p
      if (p >= 100) a.completed++
      if (r.package_code) a.packages.add(r.package_code)
    }
    if (!data || data.length < 1000) break
  }

  const rows: P6Activity[] = Object.entries(acc).map(([activityId, a]) => ({
    activityId,
    docCount: a.count,
    completedDocs: a.completed,
    avgProgressPct: a.count ? a.sum / a.count / 100 : 0,
    packages: [...a.packages].sort(),
  })).sort((x, y) => x.activityId.localeCompare(y.activityId))

  const docCount = rows.reduce((s, r) => s + r.docCount, 0)
  const weighted = rows.reduce((s, r) => s + r.avgProgressPct * r.docCount, 0)
  return {
    rows,
    total: { activities: rows.length, docCount, avgProgressPct: docCount ? weighted / docCount : 0 },
  }
}
