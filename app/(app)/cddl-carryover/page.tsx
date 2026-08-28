import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { getCarryover, getK124Status, summarise } from '@/lib/carryover/carryover'
import { getCarryoverOptions, codeForReaderValue } from '@/lib/carryover/options'
import CarryoverRegister from './register'
import ProgressStrip from './progress-strip'
import { getProgress } from '@/lib/carryover/progress'
import { applyGate } from '@/lib/carryover/gate'
import { RELEASE_SOURCE } from '@/lib/carryover/released'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The K038 carry-over register — the tender documents that never reached the CDDL.
 *
 * It sits in CoreDocs, next to the CDDL Register, because these are the same people doing
 * the same job: document control already sign in here, so nothing new has to be granted.
 * A TEMPORARY surface — remove the nav entry once the carry-over is complete.
 */
export default async function CarryoverPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const sp = await searchParams
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  let canEdit = false
  let isDeveloper = false
  if (user) {
    const { data: profile } = await auth.from('users').select('role').eq('auth_user_id', user.id).single()
    const perms = await getPermissions(auth)
    canEdit = can(perms, FK.ACTION_EDIT_CDDL, (profile?.role ?? 'reviewer') as string)
    // Only a developer can look past the gate — Morné needs the whole register to sort out
    // the undecided documents while document control works the released ones.
    isDeveloper = (profile?.role ?? '') === 'developer'
  }

  const [dAll, opts] = await Promise.all([getCarryover(), getCarryoverOptions()])
  // The gate is ON for everyone. A developer can lift it with ?all=1 to work the backlog.
  const gate = applyGate(dAll.rows)
  const showAll = isDeveloper && sp?.all === '1'
  const rows = showAll ? dAll.rows : gate.rows
  // Recompute EVERY count from the visible rows. Spreading dAll and patching two
  // fields left the tiles and package chips measuring all 528 while the list showed a
  // subset, so the summary disagreed with the table and out-of-scope chips filtered to 0.
  const d = summarise(rows)
  const k124 = await getK124Status(rows)

  // Translate the reader's English into the codes the CDDL stores, once on the server, so
  // every "use" button offers something the dropdown will actually accept.
  const mapped = Object.fromEntries(rows.map((r) => [r.temp_ref, {
    discipline: codeForReaderValue('discipline', r.ai_discipline, opts),
    doc_type: codeForReaderValue('doc_type', r.ai_doc_type, opts),
    aconex_doc_status: codeForReaderValue('aconex_doc_status', r.ai_status, opts),
  }]))

  const notRegistered = Object.values(k124).filter((k) => k && !k.inCddl).length
  const progress = getProgress(rows)

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-navy-800">
            <BookOpen className="h-6 w-6 text-navy-500" />
            CDDL Carry-over
          </h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-500">
            Documents that went out for tender without ever reaching the CDDL. Each one needs a K124 number and an area
            before it can join the register — open the document, check what the reader found in its title block, and
            record the decision. Export when you are ready to paste them into the CDDL.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/api/carryover-export" className="rounded-lg border border-navy-300 px-3 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50">
            ⭳ Export (CDDL layout)
          </a>
          <Link href="/cddl" className="text-sm font-medium text-navy-700 hover:underline">← CDDL Register</Link>
        </div>
      </div>

      {/* The banner says what is TRUE OF THIS SCOPE, and the two scopes differ. In
          'A-released' every visible row carries an engineering decision, so the page says
          proceed with all of it. In 'B' engineering has ruled on eleven of 329, so it must
          not say that — claiming it would repeat the confusion this gate exists to end. */}
      {!showAll && gate.allReleased && (
        <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <b>Everything shown here has been released by engineering — proceed with all of it.</b>{' '}
          These <b>{gate.visibleTotal}</b> documents are the ones marked <i>&ldquo;proceed with new number&rdquo;</i>,
          so each one gets a K124 number and an area. There is nothing on this page to second-guess.
          <div className="mt-1.5 text-[13px] text-emerald-800">
            <b>{gate.hidden}</b> other documents are hidden for now because engineering has not ruled on them yet.
            <b> Nothing has been deleted</b>
            {gate.hiddenButFinished > 0 && (
              <>, including <b>{gate.hiddenButFinished}</b> already completed — those are parked exactly as they were
                left until engineering confirms, because a few may have to keep their old number</>
            )}.
          </div>
          {isDeveloper && (
            <div className="mt-1.5 text-[11px] text-emerald-700">
              Developer: scope <b>{gate.scope}</b> · released set from <span className="font-mono">{RELEASE_SOURCE}</span>
              {gate.releasedOutOfScope > 0 && <> · {gate.releasedOutOfScope} released but out of scope</>} ·{' '}
              <a className="underline" href="?all=1">show all {dAll.rows.length}</a>
            </div>
          )}
        </div>
      )}

      {!showAll && !gate.allReleased && (
        <div className="mt-4 rounded-lg border border-navy-300 bg-navy-50 px-4 py-3 text-sm text-navy-900">
          <b>These are the {gate.visibleTotal} tender-folder documents — the &ldquo;B&rdquo; batch.</b>{' '}
          They came out of the vendor folders rather than the K038 register, and they span{' '}
          {new Set(gate.rows.map((r) => r.target_package)).size} packages. Work through them the same way: open the
          document, check what the reader found, record the number and the area.
          <div className="mt-1.5 text-[13px] text-navy-800">
            <b>Engineering has not triaged this batch.</b> It has ruled on <b>{gate.visibleReleased}</b> of these{' '}
            {gate.visibleTotal}; the rest carry no decision yet. So unlike the last batch, <b>not everything here is
            confirmed</b> — if a document looks as though it should keep its existing number, or you are unsure it
            belongs in K124 at all, leave it and flag it rather than allocating.
          </div>
          {gate.droppedNoEvidence > 0 && (
            <div className="mt-1.5 text-[13px] text-navy-800">
              A further <b>{gate.droppedNoEvidence}</b> files from these folders are not shown: they have{' '}
              <b>no project border and no document number</b>, so they are working files — checklists,
              adjudications, calculation templates — rather than deliverables that belong in the CDDL.
            </div>
          )}
          <div className="mt-1.5 text-[13px] text-navy-800">
            The <b>{gate.hidden - gate.droppedNoEvidence}</b> documents from the other batch are hidden, not deleted
            {gate.hiddenButFinished > 0 && <>, including <b>{gate.hiddenButFinished}</b> already completed</>}.
          </div>
          {isDeveloper && (
            <div className="mt-1.5 text-[11px] text-navy-700">
              Developer: scope <b>{gate.scope}</b>
              {gate.releasedOutOfScope > 0 && <> · {gate.releasedOutOfScope} released but out of scope</>} ·{' '}
              <a className="underline" href="?all=1">show all {dAll.rows.length}</a>
            </div>
          )}
        </div>
      )}

      <ProgressStrip p={progress} />

      {notRegistered > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <b>{notRegistered} of these already carry a K124 document number but are not in the CDDL.</b> Most are known to
          the MDDR, so they are a register gap rather than new work — the job there is to register a drawing that already
          has a number, not to allocate one. Filter by <b>K124 number, not registered</b> to see them.
        </div>
      )}

      <div className="mt-5">
        <CarryoverRegister d={d} canEdit={canEdit} opts={opts} mapped={mapped} k124={k124} phase1Read />
      </div>
    </div>
  )
}
