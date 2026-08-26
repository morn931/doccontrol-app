import { WORKING_DAY_HOURS, type CarryoverProgress } from '@/lib/carryover/progress'

// Progress and pace on the carry-over, for whoever is being asked when it will be done.
//
// The per-person figures are labelled "recorded activity" everywhere, never "hours
// worked", and the caveat sits WITH them rather than in a footnote — this table names
// people, and the header of lib/carryover/progress.ts explains why that distinction
// matters before anyone quotes a number from it.

const hrs = (ms: number) => (ms / 3600000).toFixed(1)
const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0)
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

export default function ProgressStrip({ p }: { p: CarryoverProgress }) {
  const readyPct = pct(p.ready, p.total)
  const partialPct = pct(p.partial, p.total)
  const maxDay = Math.max(1, ...p.byDay.map((d) => d.decisions))

  return (
    <div className="mt-4 rounded-xl border border-navy-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-navy-800">Progress and pace</h2>
        <span className="text-xs text-slate-500">
          Done means a K124 number <b>and</b> an area recorded — the same rule the register marks
          <span className="mx-1 rounded border border-emerald-400 bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-800">ready</span>
          by.
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-bold text-navy-800">{readyPct.toFixed(1)}%</span>
        <span className="text-sm text-slate-600">
          <b>{p.ready.toLocaleString()}</b> of {p.total.toLocaleString()} ready to export
          {p.partial > 0 ? <> · {p.partial} part done</> : null}
          {' '}· <b>{p.remaining.toLocaleString()}</b> to go
        </span>
      </div>
      <div className="mt-2 flex h-3 w-full overflow-hidden rounded bg-neutral-100">
        <div style={{ width: `${readyPct}%`, background: '#047857' }} title={`Ready — ${p.ready}`} />
        <div style={{ width: `${partialPct}%`, background: '#B45309' }} title={`Part done — ${p.partial}`} />
      </div>

      {/* Pace and how long is left at it. */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-xl font-bold text-navy-800">{p.latestDayRate}</div>
          <div className="text-[11px] font-medium text-slate-700">decisions on the latest active day</div>
          <div className="text-[10px] text-slate-500">
            against {p.meanRate.toFixed(0)} a day averaged over {p.byDay.length} active day{p.byDay.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-xl font-bold text-navy-800">
            {p.daysAtLatest !== null ? Math.ceil(p.daysAtLatest) : '—'}
            <span className="ml-1 text-xs font-normal text-slate-500">days</span>
          </div>
          <div className="text-[11px] font-medium text-slate-700">to finish, if the latest day&apos;s pace holds</div>
          <div className="text-[10px] text-slate-500">
            {p.daysAtMean !== null ? `${Math.ceil(p.daysAtMean)} days at the average pace` : 'no pace recorded yet'}
          </div>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-xl font-bold text-navy-800">
            {Math.floor(p.medianGapSec / 60)}m {p.medianGapSec % 60}s
          </div>
          <div className="text-[11px] font-medium text-slate-700">median between consecutive decisions</div>
          <div className="text-[10px] text-slate-500">open the drawing, read the title block, decide, record</div>
        </div>
      </div>

      {/* Per person. */}
      <div className="mt-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-navy-800">Recorded activity, per person</span>
          <span className="text-[10px] text-slate-500">against a {WORKING_DAY_HOURS}-hour day · times SAST</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {['Who', 'Day', 'Decisions', 'First', 'Last', 'Recorded activity', 'of a 9-hour day', 'Sessions'].map((h, i) => (
                  <th
                    key={h}
                    className={`border border-slate-300 bg-navy-800 px-2 py-1 font-semibold text-white ${i === 2 || i >= 5 ? 'text-right' : 'text-left'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.people.flatMap((person) =>
                person.days.map((d, di) => {
                  const share = pct(d.activeMs, WORKING_DAY_HOURS * 3600000)
                  return (
                    <tr key={`${person.email}-${d.day}`}>
                      <td className="border border-slate-200 px-2 py-1 font-medium text-navy-800">
                        {di === 0 ? person.name : ''}
                      </td>
                      <td className="border border-slate-200 px-2 py-1 text-slate-600">{dayLabel(d.day)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-right font-semibold text-navy-800">{d.decisions}</td>
                      <td className="border border-slate-200 px-2 py-1 text-slate-600">{hhmm(d.first)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-slate-600">{hhmm(d.last)}</td>
                      <td className="border border-slate-200 px-2 py-1 text-right text-slate-700">{hrs(d.activeMs)} h</td>
                      <td className="border border-slate-200 px-2 py-1 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-neutral-200 align-middle">
                            <span className="block h-full rounded bg-navy-500" style={{ width: `${Math.min(100, share)}%` }} />
                          </span>
                          <span className="text-slate-600">{share.toFixed(0)}%</span>
                        </span>
                      </td>
                      <td className="border border-slate-200 px-2 py-1 text-right text-slate-600">{d.sessions}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* The caveat travels WITH the number, because this table names people. */}
        <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
          <b>What &ldquo;recorded activity&rdquo; is.</b> The time bracketed by consecutive saved decisions. It measures{' '}
          <b>throughput, not diligence</b>, and it is a lower bound: it cannot see the time before the first save of a
          session — usually the longest part, finding and opening the drawing — nor any document opened, considered and
          left undecided, which is exactly what the <b>{p.noBorderRemaining} with no project border</b> invite. A low
          figure may mean the register was worked in short bursts between other duties; on its own it does not mean the
          work was not done.
        </p>
      </div>

      {/* Daily throughput. */}
      {p.byDay.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-navy-800">Decisions per day</div>
          <div className="flex items-end gap-2">
            {p.byDay.map((d) => (
              <div key={d.day} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-semibold text-navy-800">{d.decisions}</span>
                <div className="w-10 rounded-t bg-navy-500" style={{ height: `${Math.max(4, (d.decisions / maxDay) * 56)}px` }} />
                <span className="text-[10px] text-slate-500">{dayLabel(d.day)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
