import { GUIDE, anchorFor, type GuideEntry } from '@/lib/guide/registry'

/**
 * Full CoreDocs User Guide — generated from lib/guide/registry (the same source that
 * powers the per-screen Guide button), so the manual never drifts from the app.
 */
export const metadata = { title: 'CoreDocs User Guide' }

const SECTIONS: { heading: string; matches: string[] }[] = [
  { heading: 'Getting started', matches: ['/dashboard'] },
  { heading: 'Document-control workflow', matches: ['/batches', '/reviews', '/transmittals'] },
  { heading: 'Register, search & reporting', matches: ['/documents', '/mddr', '/reporting'] },
  { heading: 'Admin', matches: ['/admin/import', '/admin/users', '/admin/vendors'] },
]

const byMatch = (m: string) => GUIDE.find(e => e.match === m)

function Section({ e }: { e: GuideEntry }) {
  return (
    <section id={anchorFor(e)} className="scroll-mt-20 border-t border-slate-200 pt-8">
      <h3 className="text-xl font-bold text-slate-900">{e.title}</h3>
      <p className="mt-1 text-slate-600">{e.intro}</p>
      {e.images.map(src => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt={e.title}
          className="mt-4 w-full max-w-3xl rounded-lg border border-slate-200 shadow-sm" />
      ))}
      <ul className="mt-4 space-y-2 max-w-3xl">
        {e.tips.map((t, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-700">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function HelpPage() {
  return (
    <div className="max-w-4xl mx-auto pb-16">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">CoreDocs User Guide</h1>
        <p className="mt-1 text-slate-500">
          A walkthrough of every screen. Each section matches the in-app <span className="font-medium text-teal-700">Guide</span> button
          you’ll see at the top of that page.
        </p>
      </header>

      {/* Table of contents */}
      <nav className="mb-10 rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Contents</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {SECTIONS.map(s => (
            <div key={s.heading}>
              <p className="text-sm font-semibold text-slate-700">{s.heading}</p>
              <ul className="mt-1 space-y-0.5">
                {s.matches.map(byMatch).filter(Boolean).map(e => (
                  <li key={(e as GuideEntry).match}>
                    <a href={`#${anchorFor(e as GuideEntry)}`} className="text-sm text-teal-700 hover:underline">
                      {(e as GuideEntry).title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Sections */}
      <div className="space-y-10">
        {SECTIONS.map(s => (
          <div key={s.heading} className="space-y-8">
            <h2 className="text-2xl font-bold text-slate-800">{s.heading}</h2>
            {s.matches.map(byMatch).filter(Boolean).map(e => <Section key={(e as GuideEntry).match} e={e as GuideEntry} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
