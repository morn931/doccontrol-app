"use client";
import { useMemo, useState, useTransition } from "react";
import { saveDecision, setStatus } from "./actions";
import { isReady, type CarryoverRow, type CarryoverView, type DecisionField, type K124Status } from "@/lib/carryover/types";
import type { CarryoverOptions, Option } from "@/lib/carryover/options";

// The carry-over register. A controller opens the document, sees what the reader found,
// and records the decision — the AI's reading sits BESIDE each field, never inside it, so
// an extracted value can never be mistaken for an approved one. "Use" copies it across in
// one click, but it is still a person choosing it.

const PILL = "rounded border px-1.5 py-0.5 text-[10px] font-medium";

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3.5">
      <div className={`text-xl font-bold ${tone ?? "text-[#0B3563]"}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-medium text-slate-600">{label}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

/**
 * One editable cell.
 *
 * `options` present  -> a real dropdown; the value can only be one the CDDL understands.
 * `suggest` present  -> a long list (broad type) offered as type-ahead, free text allowed.
 * neither            -> plain text (titles, comments, owner).
 *
 * The reader's finding is offered beneath, ALREADY TRANSLATED into the code the CDDL
 * stores -- it writes "Electrical" where the register wants "E". Where it cannot be
 * translated the raw value is still shown and marked OFF-LIST, so a controller sees "the
 * document says Issued for Tender and that is not one of our six statuses" rather than a
 * value that was quietly dropped or forced into the nearest slot.
 */
function Field({
  row, field, label, ai, aiInList = true, options, suggest, onSaved,
}: {
  row: CarryoverRow; field: DecisionField; label: string;
  ai?: string | null; aiInList?: boolean;
  options?: Option[]; suggest?: Option[];
  onSaved: (f: DecisionField, v: string) => void;
}) {
  const current = (row[field] as string | null) ?? "";
  const [val, setVal] = useState(current);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const dirty = val !== current;
  const listId = suggest ? `dl-${row.temp_ref}-${field}` : undefined;

  const commit = (v: string) => {
    if (v === current) return;
    start(async () => {
      const res = await saveDecision(row.temp_ref, { [field]: v } as Partial<Record<DecisionField, string>>);
      if (!res.ok) { setErr(res.error); setVal(current); } else { setErr(null); onSaved(field, v); }
    });
  };

  const cls = `w-full rounded border px-2 py-1 text-xs outline-none ${
    err ? "border-rose-400 bg-rose-50" : dirty ? "border-amber-400 bg-amber-50" : "border-neutral-300 focus:border-teal-400"
  } ${pending ? "opacity-60" : ""}`;

  // A value already recorded that is not on the list must stay selectable, or simply
  // opening the dropdown would discard it.
  const offList = !!(options && val && !options.some((o) => o.value === val));

  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</span>

      {options ? (
        <select
          value={val}
          onChange={(e) => { setVal(e.target.value); commit(e.target.value); }}
          disabled={pending}
          className={cls}
        >
          <option value="">&mdash;</option>
          {offList && <option value={val}>{val} (not on the list)</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <>
          <input
            value={val}
            list={listId}
            onChange={(e) => setVal(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            disabled={pending}
            className={cls}
          />
          {suggest && (
            <datalist id={listId}>
              {suggest.slice(0, 400).map((o) => <option key={o.value} value={o.value} />)}
            </datalist>
          )}
        </>
      )}

      {ai && ai !== val && (
        <button
          type="button"
          onClick={() => { setVal(ai); commit(ai); }}
          title={aiInList ? "Use what the reader found in the document" : "The reader found this, but it is not one of the standard values"}
          className={`mt-0.5 block max-w-full truncate text-left text-[10px] hover:underline ${aiInList ? "text-sky-700" : "text-amber-700"}`}
        >
          reader: {ai} <span className={aiInList ? "text-sky-500" : "text-amber-600"}>&mdash; {aiInList ? "use" : "use (off-list)"}</span>
        </button>
      )}
      {err && <span className="mt-0.5 block text-[10px] text-rose-600">{err}</span>}
    </label>
  );
}

function RowCard({ row, opts, mapped, k124 }: {
  row: CarryoverRow; opts: CarryoverOptions;
  mapped: { discipline?: { value: string; inList: boolean } | null; doc_type?: { value: string; inList: boolean } | null; aconex_doc_status?: { value: string; inList: boolean } | null };
  k124: K124Status | null;
}) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(row);
  const [pending, start] = useTransition();
  const onSaved = (f: DecisionField, v: string) => setLocal((p) => ({ ...p, [f]: v || null }));
  const ready = isReady(local);
  const files = row.source_files ?? [];

  return (
    <div className={`rounded-lg border ${ready ? "border-emerald-300 bg-emerald-50/40" : row.ai_error ? "border-rose-200 bg-rose-50/40" : "border-neutral-200 bg-white"}`}>
      {/* The whole header row toggles the panel. Opening the form is the primary action
          here — the reference used to be a link to the file, which competed with it and
          won, so the file link now lives inside the panel where it is actually needed. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50"
      >
        <span className={`w-5 shrink-0 text-base leading-none ${open ? "text-[#0097A3]" : "text-slate-400"}`}>
          {open ? "▾" : "▸"}
        </span>

        <span className="shrink-0 font-mono text-[10px] text-slate-400">{row.temp_ref}</span>

        <span className="min-w-0 flex-1 truncate text-xs text-slate-700" title={local.ai_title ?? row.source_path}>
          {local.title || local.major_desc || row.ai_title || row.source_path.split("/").pop()}
        </span>

        {/* For a document that already carries a K124 number, whether it is registered
            matters far more than whether it has a border — it changes the job from
            "allocate a number" to "register a drawing that already has one". */}
        {k124 ? (
          k124.inCddl
            ? <span className={`${PILL} border-emerald-300 bg-emerald-50 text-emerald-800`} title={`${k124.number} (found via ${k124.where})`}>
                Existing K124 number — in the CDDL
              </span>
            : k124.inMddr
              ? <span className={`${PILL} border-amber-300 bg-amber-50 text-amber-800`} title={`${k124.number} (found via ${k124.where}) — the MDDR has it, the CDDL does not`}>
                  Existing K124 number — in MDDR, NOT in CDDL
                </span>
              : <span className={`${PILL} border-rose-300 bg-rose-50 text-rose-800`} title={`${k124.number} (found via ${k124.where}) — no register has it`}>
                  Existing K124 number — in NO register
                </span>
        ) : (
          <>
            {row.ai_has_border === false && <span className={`${PILL} border-amber-300 bg-amber-50 text-amber-800`}>no border</span>}
            {row.ai_has_border === true && <span className={`${PILL} border-emerald-300 bg-emerald-50 text-emerald-800`}>in border</span>}
          </>
        )}
        {!row.ai_read_at && <span className={`${PILL} border-neutral-300 bg-neutral-50 text-neutral-500`}>not read yet</span>}
        {row.ai_error && <span className={`${PILL} border-rose-300 bg-rose-50 text-rose-700`} title={row.ai_error}>unreadable</span>}
        {row.legacy_docno
          ? <span className={`${PILL} border-slate-300 bg-slate-50 font-mono text-slate-600`}>{row.legacy_docno}</span>
          : <span className={`${PILL} border-slate-300 bg-slate-50 text-slate-500`}>never numbered</span>}
        <span className="text-[10px] text-slate-400">{row.target_package}</span>
        {ready && <span className={`${PILL} border-emerald-400 bg-emerald-100 text-emerald-800`}>ready</span>}
      </button>

      {open && (
        <div className="border-t border-neutral-200 px-3 py-3">
          {row.ai_summary && (
            <p className="mb-3 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-900">
              <b>Reader:</b> {row.ai_summary}
              {row.ai_confidence && <span className="text-sky-600"> ({row.ai_confidence} confidence)</span>}
            </p>
          )}
          {row.ai_error && (
            <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-900">
              <b>Could not be read automatically:</b> {row.ai_error} — open it and fill the fields by hand.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Field row={local} field="docno" label="RDMC document number" ai={row.ai_docno} onSaved={onSaved} />
            <Field row={local} field="wbs" label="Area / WBS" options={opts.wbs} ai={row.legacy_area} onSaved={onSaved} />
            <Field row={local} field="discipline" label="Discipline" options={opts.discipline}
                   ai={mapped.discipline?.value} aiInList={mapped.discipline?.inList} onSaved={onSaved} />
            <Field row={local} field="doc_type" label="Document type" options={opts.docType}
                   ai={mapped.doc_type?.value} aiInList={mapped.doc_type?.inList} onSaved={onSaved} />
            <Field row={local} field="revision" label="Revision" ai={row.ai_revision} onSaved={onSaved} />
            <Field row={local} field="major_desc" label="Major description" ai={row.ai_title} onSaved={onSaved} />
            <Field row={local} field="title" label="Full title" ai={row.ai_title} onSaved={onSaved} />
            <Field row={local} field="broad_type" label="Broad type" suggest={opts.broadType} ai={row.doc_class} onSaved={onSaved} />
            <Field row={local} field="area_facility" label="Area / facility" suggest={opts.plant} onSaved={onSaved} />
            <Field row={local} field="aconex_doc_status" label="Aconex doc status" options={opts.aconexStatus}
                   ai={mapped.aconex_doc_status?.value} aiInList={mapped.aconex_doc_status?.inList} onSaved={onSaved} />
            <Field row={local} field="seq_no" label="Sequential no." onSaved={onSaved} />
            <Field row={local} field="ppe_docno" label="PPE doc number" onSaved={onSaved} />
            <Field row={local} field="sheet" label="Sht. # of #" onSaved={onSaved} />
            <Field row={local} field="doc_owner" label="Doc owner" onSaved={onSaved} />
            <Field row={local} field="main_group" label="Main group" onSaved={onSaved} />
            <Field row={local} field="sub_group" label="Sub group" onSaved={onSaved} />
            <Field row={local} field="comments" label="Comments" onSaved={onSaved} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-2 text-[11px] text-slate-500">
            <span className="font-medium">Open:</span>
            {files.map((f) => {
              const name = f.split("/").pop() ?? f;
              // Label the link with the document number where the file carries one; where
              // it does not, a raw file name tells a controller nothing, so say plainly
              // what the link is for.
              const num = /6105A[A-Z]?\d{3}[A-Z]?-\d{4}-[A-Z0-9]{4}-[0-9X]{4}/i.exec(name)?.[0];
              return (
                <a key={f}
                   href={`/api/carryover-doc?ref=${encodeURIComponent(row.temp_ref)}&file=${encodeURIComponent(f)}`}
                   target="_blank" rel="noreferrer" title={name}
                   className="font-medium text-sky-700 underline decoration-sky-400 underline-offset-2 hover:text-sky-900">
                  {num ?? "Link to document"}
                </a>
              );
            })}
            <span className="ml-auto flex items-center gap-2">
              {row.decided_by && <span>last edited by {row.decided_by}</span>}
              <button
                type="button"
                disabled={pending}
                onClick={() => start(async () => { await setStatus(row.temp_ref, local.status === "skipped" ? "pending" : "skipped"); })}
                className="rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-50"
              >
                {local.status === "skipped" ? "Un-skip" : "Skip"}
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CarryoverRegister({ d, canEdit, opts, mapped, k124, phase1Read }: {
  d: CarryoverView; canEdit: boolean; opts: CarryoverOptions;
  /** reader values already translated into CDDL codes, keyed by temp_ref */
  mapped: Record<string, { discipline?: { value: string; inList: boolean } | null; doc_type?: { value: string; inList: boolean } | null; aconex_doc_status?: { value: string; inList: boolean } | null }>;
  /** existing K124 number and whether it is already in the Phase 1 CDDL, per row */
  k124: Record<string, K124Status | null>;
  /** false when the Phase 1 CDDL could not be read — the pills then cannot be trusted */
  phase1Read: boolean;
}) {
  const [pkg, setPkg] = useState("all");
  const [show, setShow] = useState<"all" | "todo" | "ready" | "noborder" | "k124missing" | "unread">("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return d.rows.filter((r) => {
      if (pkg !== "all" && r.target_package !== pkg) return false;
      if (show === "todo" && isReady(r)) return false;
      if (show === "ready" && !isReady(r)) return false;
      if (show === "noborder" && r.ai_has_border !== false) return false;
      if (show === "k124missing" && !(k124[r.temp_ref] && !k124[r.temp_ref]!.inCddl)) return false;
      if (show === "unread" && (r.ai_read_at || r.ai_error)) return false;
      if (needle && !`${r.temp_ref} ${r.ai_title ?? ""} ${r.source_path} ${r.legacy_docno ?? ""} ${r.docno ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [d.rows, pkg, show, q, k124]);

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-[11px] ${active ? "border-teal-300 bg-teal-50 text-teal-800" : "border-neutral-300 text-slate-600 hover:bg-neutral-50"}`;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-5">
        <Tile label="Documents to place" value={String(d.total)} sub="from the tender transfer folder" />
        <Tile label="Ready to hand over" value={String(d.done)} sub="number and area allocated" tone={d.done ? "text-emerald-700" : undefined} />
        <Tile label="No project border" value={String(d.withoutBorder)} sub="went to tender without one" tone="text-amber-700" />
        <Tile label="Number printed on the document" value={String(d.withPrintedNumber)} sub="read from the title block" />
        <Tile label="Not yet read" value={String(d.unread + d.failed)} sub={d.failed ? `${d.failed} could not be read` : "reader still running"} />
      </div>

      {!phase1Read && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          The Phase 1 CDDL could not be read just now, so this page cannot say whether an existing K124 number is
          already registered. Everything else is unaffected.
        </div>
      )}

      {!canEdit && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          You can view this register but not edit it. Ask for the <b>carry-over edit</b> permission to allocate numbers.
        </div>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-500">Package:</span>
          <button type="button" className={chip(pkg === "all")} onClick={() => setPkg("all")}>All</button>
          {d.packages.map((p) => (
            <button key={p.name} type="button" className={chip(pkg === p.name)} onClick={() => setPkg(p.name)}>
              {p.name} <span className="text-slate-400">{p.done}/{p.docs}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-500">Show:</span>
          {([["all", "Everything"], ["todo", "Still to allocate"], ["ready", "Ready"],
             ["noborder", "No border"], ["k124missing", "K124 number, not registered"],
             ["unread", "Not read yet"]] as const).map(([k, label]) => (
            <button key={k} type="button" className={chip(show === k)} onClick={() => setShow(k)}>{label}</button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ref, title, file, number…"
            className="ml-auto w-64 rounded-lg border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-teal-400"
          />
        </div>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] text-slate-600">
          Showing <b>{rows.length}</b> of {d.total}. Click a <b>CO-reference</b> to open the document — that is the link,
          because these documents have no number yet. The reader&apos;s findings sit beside each field; <b>use</b> copies
          one across, but the decision stays yours.
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {rows.map((r) => <RowCard key={r.temp_ref} row={r} opts={opts} mapped={mapped[r.temp_ref] ?? {}} k124={phase1Read ? (k124[r.temp_ref] ?? null) : null} />)}
        {!rows.length && <p className="rounded-lg border border-neutral-200 bg-white px-3 py-6 text-center text-sm text-slate-500">Nothing matches that filter.</p>}
      </div>
    </div>
  );
}
