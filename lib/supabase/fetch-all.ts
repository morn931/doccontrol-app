// Supabase PostgREST silently truncates query results at max_rows (default 1000)
// with no error. Use fetchAll for any table that might return more than 1000 rows.
//
// Usage:
//   const rows = await fetchAll<MyType>((from, to) =>
//     db.from('mddr_entries').select('*').eq('is_active', true).range(from, to)
//   )
export async function fetchAll<T>(
  q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await q(from, from + pageSize - 1)
    if (error) throw new Error(`fetchAll: ${error.message}`)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return out
}
