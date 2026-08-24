# CoreDocs — comment checklist with jump-to-page
## Implementation instructions for Morné

Answers Wes's request: leave comments on a 113-page PDF, submit, and let the originator work a
clickable checklist instead of scrolling.

**Repo:** `doccontrol-app` (own Supabase `tjzeahdimbekuizegsky`).
**No migration required.** `document_markups.comments` is free `jsonb` and the API copies it
through untouched — the richer objects below just land in the existing column.

Three files change. Roughly 150 lines total.

---

## 0. What already works (don't rebuild it)

`components/markup/pdf-markup.tsx` → `serialize()` (line ~169) already walks every page's fabric
canvas and returns `{ layer, comments }`. `save()` POSTs it to `${apiBase}/markup`, which upserts
into `document_markups` keyed `(document_version_id, review_task_id)`. `saveToSharePoint()` already
calls `save()` before flattening, so comments are persisted at submit time.

Two things are wrong with it:

1. `serialize()` only captures `i-text` / `text`. **Wes's red pen circles produce nothing.**
2. It captures no coordinates and no stable id, so there is nothing to jump *to*.

---

## 1. `components/markup/pdf-markup.tsx` — capture every mark

### 1a. Give every object a stable id and a note

Add near the other refs (~line 33):

```ts
const seqRef = useRef(0)
const noteAskRef = useRef<{ fab: any; obj: any } | null>(null)
const [noteDraft, setNoteDraft] = useState<{ x: number; y: number; value: string } | null>(null)
```

In `wireFab()`, the `object:added` handler currently only pushes undo. Replace it with:

```ts
fab.on('object:added', (e: any) => {
  if (skipHistoryRef.current || e.target?._skipHistory) return
  const o = e.target
  if (o && !o.cfId) {
    o.cfId = `m${Date.now().toString(36)}-${seqRef.current++}`
    o.cfAuthorColor = colorRef.current
  }
  undoRef.current.push({ fab, obj: o })
  // A pen stroke / shape / highlight carries no words. Ask for one line so the
  // originator gets an actionable checklist entry rather than a circle.
  if (o && !o.cfNote && (o.type === 'path' || o.type === 'rect' || o.type === 'ellipse'
      || o.type === 'line' || o.type === 'group' || o.type === 'triangle')) {
    const c = o.getCenterPoint?.() ?? { x: o.left ?? 0, y: o.top ?? 0 }
    noteAskRef.current = { fab, obj: o }
    setNoteDraft({ x: c.x, y: c.y, value: '' })
  }
})
```

`fabric` preserves unknown properties only if you declare them. Add this once, right after
`fabricLibRef.current = f` in the load effect (~line 87):

```ts
f.Object.customProperties = ['cfId', 'cfNote', 'cfAuthorColor']
```

> Without that line the ids and notes are lost the moment a draft is saved and resumed, because
> `toJSON()` drops them silently. This is the single easiest thing to get wrong here.

### 1b. The one-line note prompt

Render it inside the returned JSX, just before the closing `</div>`:

```tsx
{noteDraft && (
  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30"
       onClick={() => { noteAskRef.current = null; setNoteDraft(null) }}>
    <div className="card p-4 w-[26rem] space-y-3" onClick={e => e.stopPropagation()}>
      <p className="text-sm font-semibold text-slate-900">What is the comment?</p>
      <p className="text-xs text-slate-500">
        One line. It becomes the originator&apos;s checklist entry and jumps back to this mark.
      </p>
      <input autoFocus value={noteDraft.value}
        onChange={e => setNoteDraft({ ...noteDraft, value: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter') commitNote(); if (e.key === 'Escape') { noteAskRef.current = null; setNoteDraft(null) } }}
        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        placeholder="e.g. Incorrect Rev" />
      <div className="flex justify-end gap-2">
        <button onClick={() => { noteAskRef.current = null; setNoteDraft(null) }}
          className="px-3 py-1.5 rounded-md text-sm border border-slate-300">Skip</button>
        <button onClick={commitNote}
          className="px-3 py-1.5 rounded-md text-sm font-semibold bg-navy-700 text-white">Add</button>
      </div>
    </div>
  </div>
)}
```

And the handler:

```ts
function commitNote() {
  const ask = noteAskRef.current
  if (ask && noteDraft?.value.trim()) ask.obj.cfNote = noteDraft.value.trim()
  noteAskRef.current = null; setNoteDraft(null)
}
```

**Skip is deliberate.** A reviewer sketching an alignment line should not be forced to narrate it —
an unnoted mark simply produces no checklist entry, exactly as today.

### 1c. Rewrite `serialize()` (replaces lines ~168–180)

```ts
function serialize() {
  const layer: Record<number, any> = {}
  const comments: {
    id: string; page: number; text: string; kind: string
    x: number; y: number; pw: number; ph: number; color?: string
  }[] = []
  fabsRef.current.forEach((fab, i) => {
    const objs = fab.getObjects()
    if (objs.length) layer[i] = fab.toJSON()
    const dim = pageDimsRef.current[i] ?? { w: 0, h: 0 }
    for (const o of objs) {
      const isText = o.type === 'i-text' || o.type === 'text'
      const text = isText ? String(o.text ?? '').trim() : String(o.cfNote ?? '').trim()
      if (!text) continue
      const c = o.getCenterPoint?.() ?? { x: o.left ?? 0, y: o.top ?? 0 }
      comments.push({
        id: o.cfId ?? `p${i}-${comments.length}`,
        page: i + 1, text,
        kind: isText ? 'text' : o.type,
        // LOGICAL page space (zoom = 1). pageDimsRef is already kept for this.
        x: Math.round(c.x), y: Math.round(c.y), pw: Math.round(dim.w), ph: Math.round(dim.h),
        color: o.cfAuthorColor ?? o.stroke ?? o.fill ?? undefined,
      })
    }
  })
  return { layer, comments }
}
```

Storing `pw`/`ph` alongside `x`/`y` means the jump still lands correctly if the render scale
(`SCALE`, `MAX_DIM`) ever changes — scroll to `y / ph` of the page box rather than a raw pixel.

### 1d. The panel and the jump

Add state and the scroll function:

```ts
const [panel, setPanel] = useState(false)
const [items, setItems] = useState<any[]>([])

function refreshPanel() { setItems(serialize().comments); setPanel(true) }

function jumpTo(c: any) {
  const outer = outersRef.current[c.page - 1]
  if (!outer) return
  const z = zoomRef.current
  const target = outer.offsetTop + (c.ph ? (c.y / c.ph) * outer.offsetHeight : 0)
  const box = containerRef.current!
  box.scrollTo({ top: Math.max(0, target - box.clientHeight / 3), behavior: 'smooth' })
  // Flash the mark so the eye finds it on a dense page.
  const fab = fabsRef.current[c.page - 1]
  const obj = fab?.getObjects().find((o: any) => o.cfId === c.id)
  if (obj) {
    const original = obj.opacity ?? 1
    let n = 0
    const t = setInterval(() => {
      obj.set('opacity', n % 2 ? original : 0.15); fab.renderAll()
      if (++n > 5) { clearInterval(t); obj.set('opacity', original); fab.renderAll() }
    }, 160)
  }
}
```

Toolbar button, next to `⛶ Full screen`:

```tsx
<button onClick={() => (panel ? setPanel(false) : refreshPanel())}
  className="px-3 py-1.5 rounded-md text-sm font-medium border border-slate-300 hover:bg-slate-50">
  💬 Comments{items.length ? ` (${items.length})` : ''}
</button>
```

Then wrap the viewer so the panel sits beside it. Replace the final container line:

```tsx
<div className={`flex gap-3 ${fullscreen ? 'flex-1 min-h-0' : ''}`}>
  <div ref={containerRef}
       className={`flex-1 rounded-lg bg-slate-100 p-6 overflow-auto relative ${fullscreen ? 'min-h-0' : 'max-h-[80vh]'}`} />
  {panel && (
    <aside className={`w-80 shrink-0 rounded-lg border border-slate-200 bg-white overflow-auto ${fullscreen ? 'min-h-0' : 'max-h-[80vh]'}`}>
      <div className="sticky top-0 bg-slate-800 text-white px-3 py-2 text-sm font-semibold flex justify-between">
        <span>Comments {items.length}</span>
        <button onClick={() => setPanel(false)} className="text-slate-300 hover:text-white">✕</button>
      </div>
      {items.length === 0 && <p className="p-3 text-xs text-slate-500">No comments yet. Use T Text, or add a note when you draw.</p>}
      {Object.entries(items.reduce((a: any, c) => { (a[c.page] ||= []).push(c); return a }, {})).map(([pg, list]: any) => (
        <div key={pg} className="border-b border-slate-100">
          <div className="px-3 py-1.5 bg-slate-50 text-xs font-semibold text-slate-600">
            Page {pg} <span className="text-slate-400">({list.length})</span>
          </div>
          {list.map((c: any) => (
            <button key={c.id} onClick={() => jumpTo(c)}
              className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-sky-50 flex gap-2">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: c.color ?? '#64748b' }} />
              <span>{c.text}</span>
            </button>
          ))}
        </div>
      ))}
    </aside>
  )}
</div>
```

`containerRef` is the scrolling element (it carries `overflow-auto`), which is why `jumpTo` uses
`box.scrollTo` on it rather than `scrollIntoView` — `scrollIntoView` would also scroll the page
behind it and fight the sticky toolbar.

Finally, call `refreshPanel()` at the end of `save()` so the count updates on save.

---

## 2. `app/api/reviews/[id]/markup/route.ts` — resolution flags

The POST already passes `comments` straight through, so the richer objects need **no change to
store**. Add only the ability for the originator to tick items off. Insert a `PATCH`:

```ts
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params
  const { commentId, resolved } = await req.json()
  const db = createServiceClient()
  const task = await taskCtx(db, id)
  if (!task) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
  const { data: profile } = await db.from('users').select('email').eq('auth_user_id', user.id).single()

  const { data: row } = await db.from('document_markups')
    .select('comments')
    .eq('document_version_id', task.document_version_id)
    .eq('review_task_id', task.id).maybeSingle()
  const comments = (row?.comments ?? []).map((c: any) => c.id === commentId
    ? { ...c, resolved: !!resolved,
        resolved_by: resolved ? ((profile as any)?.email ?? user.email) : null,
        resolved_at: resolved ? new Date().toISOString() : null }
    : c)

  const { error } = await db.from('document_markups').update({ comments })
    .eq('document_version_id', task.document_version_id).eq('review_task_id', task.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

**Read-modify-write is a lost-update risk** if two people tick simultaneously. On a single
originator working a checklist that is acceptable; if it ever becomes concurrent, move `comments`
to its own table (next free CoreDocs migration is **`049`** — `HANDOVER.md` still says `046`, which
is stale).

---

## 3. The originator's view

Wes's actual deliverable. Build `components/markup/comment-checklist.tsx` — the same grouped list
as §1d, but fed from `GET ${apiBase}/markup` rather than the live canvases, with a checkbox per
item calling the `PATCH`, and a resolved count in the header (`4 of 107 resolved`).

Mount it on the originator's document page. It does **not** need the fabric canvases: clicking an
item scrolls the flattened PDF viewer by `page` and `y/ph`, which is why those fields are stored.

Reuse the reply-thread pattern already working in `components/markup/reviewer-notes.tsx` and the
Engineering Action Register — the question/answer loop closes properly there. Do not invent a second
comment mechanism beside it.

---

## 4. One existing quirk to check while you are in here

`saveToSharePoint()` flattens the mark-ups into the PDF, then reloads the flattened file — and
`loadBytes()` ends by calling `loadSaved()`, which re-applies the saved fabric layer on top. So
after a SharePoint save the marks appear to exist twice (once baked, once live), and the next
`save()` would then write duplicate comments.

Worth confirming on a real document before shipping the panel, because the panel is what will make
it visible. The fix is to clear the stored `layer` (keeping `comments`) as part of the commit.

---

## 5. Test before it reaches a reviewer

Use the 113-page document in the screenshot.

1. Text comment on p6, pen circle + note on p19, shape + note on p93.
2. Panel shows 3, grouped by page, coloured by reviewer.
3. Click each — correct page, mark flashes. Repeat at 40% and 400% zoom, and on a **landscape
   page** (the `/Rotate 90` case that already required special handling in `flattenBytes`).
4. Save draft, hard refresh, reopen — ids and notes survive (this is what §1a's
   `customProperties` line protects).
5. Save to SharePoint, then check §4.

---

## 6. What to tell Wes now

There is no download-comment-resubmit procedure, and he should not start one. In-app markup is the
route, his comments are already captured with page numbers every time he saves, and the panel that
turns them into a clickable checklist is the work above. Until it lands, the interim is the **T
Text** tool rather than the pen — only text is captured today.
