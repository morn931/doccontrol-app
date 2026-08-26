import type { CarryoverProgress } from '@/lib/carryover/progress'

// Where the carry-over stands, for the people doing it.
//
// ⚠️ THIS IS A SCOREBOARD, NOT A TIMESHEET — and that is a deliberate design decision, not
// an oversight. An earlier version of this strip showed each controller's start and finish
// times, session count and share of a nine-hour day. Those numbers are derived from WHEN A
// DECISION WAS SAVED, which cannot see the reading, checking and deciding that happens
// between saves, and shown per person they read as an audit of someone's hours rather than
// a measure of the work. They were removed on purpose. If you are tempted to put them
// back, read the header of lib/carryover/progress.ts first.
//
// What is here instead: one number for where the register stands, a target for today that
// the team sets by their own best day, and a finish date that moves closer when they beat
// it. Contribution counts are shown as credit — no times, no ranking by effort.

const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0)
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })

export default function ProgressStrip({ p }: { p: CarryoverProgress }) {
  const readyPct = pct(p.ready, p.total)
  const partialPct = pct(p.partial, p.total)
  const maxDay = Math.max(1, ...p.byDay.map((d) => d.decisions))
  // The target is the team's own best day. It is never zero, so the bar always has
  // something to fill, and it rises only when they raise it themselves.
  const target = Math.max(1, p.bestDay)
  const todayPct = pct(p.today, target)
  const beatenIt = p.today >= target && p.bestDay > 0

  return (
    <div className="mt-4 rounded-xl border border-navy-200 bg-white p-4">
      {/* ── One number, at the top, for anyone who opens the page ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-baseline gap-3">
            <span className="text-5xl font-bold text-navy-800">{readyPct.toFixed(1)}%</span>
            <span className="text-sm text-slate-600">
              <b className="text-navy-800">{p.ready.toLocaleString()}</b> of {p.total.toLocaleString()} ready to export
            </span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500">
            A document is ready when it has a K124 number <b>and</b> an area — the same rule the register marks
            <span className="mx-1 rounded border border-emerald-400 bg-emerald-100 px-1 text-[10px] font-semibold text-emerald-800">ready</span>
            by. <b>{p.remaining.toLocaleString()}</b> to go.
          </div>
        </div>
        {p.projectedFinish && p.remaining > 0 && (
          <div className="text-right">
            <div className="text-xs text-slate-500">On this pace, finished by</div>
            <div className="text-lg font-bold text-navy-800">{dayLabel(p.projectedFinish)}</div>
            <div className="text-[10px] text-slate-400">beat the target and this date comes forward</div>
          </div>
        )}
      </div>

      <div className="mt-3 flex h-4 w-full overflow-hidden rounded bg-neutral-100">
        <div style={{ width: `${readyPct}%`, background: '#047857' }} title={`Ready — ${p.ready}`} />
        <div style={{ width: `${partialPct}%`, background: '#B45309' }} title={`Part done — ${p.partial}`} />
      </div>

      {/* ── Today's goal ── */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className={`rounded-lg border p-3 lg:col-span-2 ${beatenIt ? 'border-emerald-300 bg-emerald-50/60' : 'border-navy-200 bg-navy-50/40'}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-navy-800">Today</span>
            <span className="text-[11px] text-slate-500">
              target is your own best day{p.bestDayOn ? ` — ${target} on ${dayLabel(p.bestDayOn)}` : ''}
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${beatenIt ? 'text-emerald-700' : 'text-navy-800'}`}>{p.today}</span>
            <span className="text-sm text-slate-600">of {target}</span>
            {beatenIt && <span className="rounded border border-emerald-400 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">best day yet</span>}
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded bg-white">
            <div
              className="h-full rounded"
              style={{ width: `${Math.min(100, todayPct)}%`, background: beatenIt ? '#047857' : '#1E4E8C' }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
          <div className="text-xl font-bold text-navy-800">{Math.round(p.meanRate)}</div>
          <div className="text-[11px] font-medium text-slate-700">a day, on average so far</div>
          <div className="text-[10px] text-slate-500">
            {p.medianGapSec > 0 && <>about {Math.floor(p.medianGapSec / 60)}m {p.medianGapSec % 60}s per document</>}
          </div>
        </div>
      </div>

      {/* ── Day by day ──
             NO NAMES ANYWHERE ON THIS STRIP. The per-person table went first, then the
             contribution chips: both put individuals on a page their own team opens, and
             the register is worked jointly. The daily bars show the same movement without
             attributing it, which is all anyone needs to see where it stands. */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        {p.byDay.length > 1 && (
          <div>
            <div className="mb-1 text-xs font-semibold text-navy-800">Decisions per day</div>
            <div className="flex items-end gap-2">
              {p.byDay.map((d) => (
                <div key={d.day} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-semibold text-navy-800">{d.decisions}</span>
                  <div
                    className="w-9 rounded-t"
                    style={{
                      height: `${Math.max(4, (d.decisions / maxDay) * 52)}px`,
                      background: d.decisions === maxDay ? '#047857' : '#1E4E8C',
                    }}
                  />
                  <span className="text-[10px] text-slate-500">{dayLabel(d.day)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ── The two things that would move the number fastest ── */}
      {(p.noBorderRemaining > 0 || p.unreadRemaining > 0) && (
        <p className="mt-3 border-t border-neutral-200 pt-2 text-[11px] leading-relaxed text-slate-600">
          <b className="text-navy-800">What is slowing the rest down.</b>{' '}
          {p.noBorderRemaining > 0 && (
            <><b>{p.noBorderRemaining}</b> of the {p.remaining.toLocaleString()} left have no project border, so each one is a judgement call rather than a look-up — one agreed rule for those would clear them in a run. </>
          )}
          {p.unreadRemaining > 0 && <><b>{p.unreadRemaining}</b> could not be opened by the reader and need the file finding first.</>}
        </p>
      )}
    </div>
  )
}
