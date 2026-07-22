import "./print-report.css";

/** Shared print/PDF letterhead — title, subtitle and date are always caller-supplied,
 *  never hardcoded, so every report gets its own dynamic banner text. Page numbering
 *  is handled separately in print-report.css via CSS counters (recalculates per print).
 *  Layout is side-by-side (logo/title left, crane box right) rather than an overlay, so
 *  long titles can never collide with the artwork. */
export function PrintHeader({ title, subtitle, date }: { title: string; subtitle: string; date: string }) {
  return (
    <div id="print-report-header" className="print-header hidden">
      <img src="/coreflow/logo/coreflow-logo-header-crop.png" alt="CoreFlow" className="print-logo" />
      <div className="print-divider" />
      <div className="print-title-block">
        <div className="print-title">{title}</div>
        <div className="print-subtitle">{subtitle}</div>
      </div>
      <div className="print-header-fill hidden" />
      <div className="print-crane hidden">
        <img src="/coreflow/header/backgrounds/hero-industrial-desktop-master-1150x202.png" alt="" className="print-crane-img" />
      </div>
      <div className="print-date hidden">{date}</div>
    </div>
  );
}
