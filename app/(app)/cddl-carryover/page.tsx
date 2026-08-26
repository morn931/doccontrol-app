import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermissions, can, FK } from '@/lib/permissions'
import { getCarryover, getK124Status } from '@/lib/carryover/carryover'
import { getCarryoverOptions, codeForReaderValue } from '@/lib/carryover/options'
import CarryoverRegister from './register'
import ProgressStrip from './progress-strip'
import { getProgress } from '@/lib/carryover/progress'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The K038 carry-over register — the tender documents that never reached the CDDL.
 *
 * It sits in CoreDocs, next to the CDDL Register, because these are the same people doing
 * the same job: document control already sign in here, so nothing new has to be granted.
 * A TEMPORARY surface — remove the nav entry once the carry-over is complete.
 */
export default async function CarryoverPage() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  let canEdit = false
  if (user) {
    const { data: profile } = await auth.from('users').select('role').eq('auth_user_id', user.id).single()
    const perms = await getPermissions(auth)
    canEdit = can(perms, FK.ACTION_EDIT_CDDL, (profile?.role ?? 'reviewer') as string)
  }

  const [d, opts] = await Promise.all([getCarryover(), getCarryoverOptions()])
  const k124 = await getK124Status(d.rows)

  // Translate the reader's English into the codes the CDDL stores, once on the server, so
  // every "use" button offers something the dropdown will actually accept.
  const mapped = Object.fromEntries(d.rows.map((r) => [r.temp_ref, {
    discipline: codeForReaderValue('discipline', r.ai_discipline, opts),
    doc_type: codeForReaderValue('doc_type', r.ai_doc_type, opts),
    aconex_doc_status: codeForReaderValue('aconex_doc_status', r.ai_status, opts),
  }]))

  const notRegistered = Object.values(k124).filter((k) => k && !k.inCddl).length
  const progress = getProgress(d.rows)

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
