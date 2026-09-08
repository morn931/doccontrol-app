'use client'
// The "Notes to the Drawing office / Engineer" field lives in the room's-call panel; the
// send buttons live in the markup toolbar. Both are client components on the same page, so a
// module-level store lets the buttons read the latest text and wait for an autosave that is
// still in flight — otherwise a note typed and sent in the same breath would miss the email.
let latest = ''
let pending: Promise<unknown> | null = null
export const noteStore = {
  get: () => latest,
  set: (v: string) => { latest = v },
  track: (p: Promise<unknown>) => { pending = p.finally(() => { if (pending === p) pending = null }) },
  flush: async () => { if (pending) { try { await pending } catch {} } },
}
