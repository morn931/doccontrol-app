// Keep a session in step with its COLAB folder without anyone pressing Pull — run on page
// load (the sessions list and the session page), throttled per session so a busy morning
// of refreshes does not walk SharePoint on every render.
//
//   new file in the folder tree      → pulled (working copy + row), exactly as Pull does
//   a pulled file moved in the tree  → its row re-pointed to the new URL (same name), so
//                                      quality results and hand-over keep working
// A file re-saved in place keeps the same URL and needs nothing here; the room reviews the
// working copy taken at pull time, and scripts/prelim-repoint-tender.mjs refreshes untouched
// working copies with a hash check when asked. Errors are recorded on the session, never
// thrown into the page.
import { createServiceClient } from '@/lib/supabase/server'
import { listFolderTree, pullFilesIntoSession, type PullSession } from './pull'

export const SYNC_EVERY_MS = 90 * 1000
const running = new Map<string, Promise<SyncResult>>()

export type SyncResult = { pulled: number; repointed: number; failed: number; skipped: boolean; error?: string }

export async function syncSession(session: PullSession & { last_synced_at?: string | null }, byEmail: string, force = false): Promise<SyncResult> {
  if (session.status !== 'open') return { pulled: 0, repointed: 0, failed: 0, skipped: true }
  if (!force && session.last_synced_at && Date.now() - new Date(session.last_synced_at).getTime() < SYNC_EVERY_MS) return { pulled: 0, repointed: 0, failed: 0, skipped: true }
  // one sync per session at a time, even when two people refresh together
  const inflight = running.get(session.id)
  if (inflight) return inflight
  const p = (async (): Promise<SyncResult> => {
    const db = createServiceClient()
    try {
      const files = await listFolderTree(session, session.source_folder)
      const { data: docs } = await db.from('prelim_document').select('id, source_file_url, source_file_name').eq('session_id', session.id)
      const known = new Set((docs ?? []).map((d: any) => d.source_file_url))
      const inTree = new Set(files.map(f => f.webUrl))
      const byName = new Map<string, typeof files>()
      for (const f of files) { const k = f.name.toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k)!.push(f) }
      // re-point rows whose file moved within the tree (same name, one candidate)
      let repointed = 0
      for (const d of (docs ?? []) as any[]) {
        if (inTree.has(d.source_file_url)) continue
        const hits = byName.get(String(d.source_file_name).toLowerCase()) ?? []
        if (hits.length === 1 && !known.has(hits[0].webUrl)) {
          await db.from('prelim_document').update({ source_file_url: hits[0].webUrl }).eq('id', d.id)
          known.add(hits[0].webUrl); repointed++
        }
      }
      // pull what is new
      const fresh = files.filter(f => !known.has(f.webUrl))
      const results = fresh.length ? await pullFilesIntoSession(session, fresh, byEmail) : []
      const pulled = results.filter(r => r.ok && !r.skipped).length, failed = results.filter(r => !r.ok).length
      const note = `${new Date().toISOString().slice(0, 16)}Z: ${files.length} in folder · pulled ${pulled} · re-pointed ${repointed}${failed ? ` · failed ${failed}: ${results.filter(r => !r.ok).slice(0, 3).map(r => `${r.name} (${r.error})`).join('; ')}` : ''}`
      await db.from('prelim_session').update({ last_synced_at: new Date().toISOString(), last_sync_note: note }).eq('id', session.id)
      return { pulled, repointed, failed, skipped: false }
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      // stamp the time anyway so a broken folder does not re-walk on every render
      await db.from('prelim_session').update({ last_synced_at: new Date().toISOString(), last_sync_note: `${new Date().toISOString().slice(0, 16)}Z: sync failed — ${msg}` }).eq('id', session.id).then(() => null, () => null)
      return { pulled: 0, repointed: 0, failed: 0, skipped: false, error: msg }
    } finally { running.delete(session.id) }
  })()
  running.set(session.id, p)
  return p
}
