/**
 * Controller notification email for the in-app intake — branded Coreflow layout.
 * Pure (no side effects, no SharePoint/DB deps) so it can be unit-previewed. The poller
 * builds the HTML from the AI review and hands it to sendEmail.
 *
 * Layout: one solid navy header (what + where it came from) → a card per document with the
 * number, title and an overall badge → two side-by-side boxes, green "Correct" vs red "Needs
 * attention", with the findings listed under each → the AI's note.
 */
import type { AiReview } from './ai-review'

const CF = {
  navy: '#0b2a5b', navySub: '#b7cbee', ink: '#1f2937', muted: '#6b7280', line: '#e5e7eb',
  green: '#157a3a', greenBg: '#eef7f0', greenLine: '#c3e3cd',
  red: '#b02a2a', redBg: '#fdeeee', redLine: '#f0c9c9',
  blue: '#1d4ed8', blueBg: '#e9eefc',
}
const FIELD_LABEL: Record<string, string> = {
  document_number: 'Document number', title: 'Title', revision: 'Revision',
  status_purpose: 'Status / purpose', document_type: 'Document type',
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function overallPill(overall: AiReview['overall']): string {
  const map: Record<string, [string, string, string]> = {
    PASS: ['✅ PASS', CF.green, CF.greenBg],
    MISMATCH: ['❌ MISMATCH', CF.red, CF.redBg],
    EXTRACTED: ['ℹ️ EXTRACTED', CF.blue, CF.blueBg],
  }
  const [label, fg, bg] = map[overall] ?? map.EXTRACTED
  return `<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:${bg};color:${fg};font-size:13px;font-weight:700;white-space:nowrap">${label}</span>`
}

/** Split the review into a "correct" list (green) and an "issues" list (red). */
function splitFindings(r: AiReview): { correct: string[]; issues: string[] } {
  const correct: string[] = [], issues: string[] = []
  for (const v of r.validation) {
    if (v.match) correct.push(`${FIELD_LABEL[v.field] ?? v.field} matches the SDDR`)
    else issues.push(`<b>${FIELD_LABEL[v.field] ?? v.field}</b> — SDDR &ldquo;${esc(v.expected)}&rdquo; vs document &ldquo;${esc(v.found)}&rdquo;`)
  }
  if (r.checks.has_table_of_contents) correct.push('Table of contents present')
  else if (r.checks.toc_required_but_missing) issues.push('Table of contents appears to be missing')
  if (r.checks.appears_correct_template) correct.push('Correct vendor template')
  else issues.push('Template &mdash; please verify')
  if (r.document_kind === 'drawing') {
    if (r.checks.cover_page_label === 'ok') correct.push('Cover-page label correct')
    else if (r.checks.cover_page_label === 'missing') issues.push('Cover-page label missing ("… – Cover Page")')
    if (r.checks.toc_page_label === 'ok') correct.push('Contents-page label correct')
    else if (r.checks.toc_page_label === 'missing') issues.push('Contents-page label missing ("… – Table of Contents")')
  }
  if (!r.validation.length && !correct.length) correct.push('Document details extracted')
  return { correct, issues }
}

function findingsBox(title: string, items: string[], kind: 'good' | 'bad'): string {
  const [fg, bg, ln] = kind === 'good' ? [CF.green, CF.greenBg, CF.greenLine] : [CF.red, CF.redBg, CF.redLine]
  const body = items.length
    ? `<ul style="margin:8px 0 0;padding-left:18px">${items.map((i) => `<li style="margin:4px 0;color:${CF.ink};font-size:15px;line-height:1.45">${i}</li>`).join('')}</ul>`
    : `<div style="margin-top:8px;color:${CF.muted};font-size:15px">${kind === 'good' ? '&mdash;' : 'Nothing flagged.'}</div>`
  return `<td valign="top" width="50%" style="padding:0 5px">
    <div style="border:1px solid ${ln};background:${bg};border-radius:8px;padding:12px 14px;height:100%">
      <div style="color:${fg};font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:.03em">${title}</div>${body}
    </div></td>`
}

function docCard(fileName: string, r: AiReview | null): string {
  if (!r) {
    return `<div style="border:1px solid ${CF.line};border-radius:10px;padding:14px;margin:0 0 14px">
      <div style="font-weight:700;color:${CF.navy};font-size:17px">${esc(fileName)}</div>
      <div style="color:${CF.muted};font-size:15px;margin-top:4px">AI review unavailable for this document.</div></div>`
  }
  const x = r.extracted
  const { correct, issues } = splitFindings(r)
  const meta = [['Rev', x.revision], ['Purpose', x.status_purpose], ['Type', x.document_type], ['Discipline', x.discipline]]
    .filter((m) => m[1])
    .map((m) => `<span style="color:${CF.muted}">${m[0]}:</span> <span style="color:${CF.ink};font-weight:600">${esc(m[1])}</span>`)
    .join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;')
  return `<div style="border:1px solid ${CF.line};border-radius:10px;margin:0 0 16px;overflow:hidden">
    <div style="padding:14px 16px;border-bottom:1px solid ${CF.line};background:#fbfcfe">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="top">
          <div style="font-size:17px;font-weight:700;color:${CF.navy};letter-spacing:.01em">${esc(fileName.replace(/\.pdf$/i, ''))}</div>
          <div style="font-size:15px;color:${CF.ink};margin-top:4px">${esc(x.title)}</div>
        </td>
        <td valign="top" align="right" style="white-space:nowrap;padding-left:10px">${overallPill(r.overall)}</td>
      </tr></table>
      ${meta ? `<div style="font-size:14px;margin-top:8px">${meta}</div>` : ''}
    </div>
    <div style="padding:12px 11px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        ${findingsBox('✓ Correct', correct, 'good')}
        ${findingsBox('⚠ Needs attention', issues, 'bad')}
      </tr></table>
      ${r.checks.notes ? `<div style="font-size:14px;color:${CF.muted};font-style:italic;padding:10px 6px 2px;line-height:1.45">${esc(r.checks.notes)}</div>` : ''}
      ${!r.validation.length ? `<div style="font-size:13px;color:${CF.muted};padding:2px 6px">No SDDR on record for this vendor — extraction only (no field-by-field comparison).</div>` : ''}
    </div>
  </div>`
}

export function buildNotificationEmail(
  packageCode: string, packageName: string, vendorName: string,
  results: { fileName: string; review: AiReview | null }[],
): string {
  const cards = results.map((r) => docCard(r.fileName, r.review)).join('')
  return `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:680px;margin:0 auto;color:${CF.ink};border:1px solid ${CF.line};border-radius:10px;overflow:hidden">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CF.navy}"><tr><td style="padding:18px 20px">
      <div style="font-size:12px;letter-spacing:.10em;color:${CF.navySub};text-transform:uppercase">CoreDocs &middot; Vendor Document Pre-Review</div>
      <div style="font-size:21px;font-weight:800;color:#ffffff;margin-top:4px">${results.length} document${results.length === 1 ? '' : 's'} received &mdash; ${esc(packageCode)}</div>
      <div style="font-size:14px;color:${CF.navySub};margin-top:4px">From ${esc(vendorName || packageName || packageCode)} &middot; auto-reviewed by AI</div>
    </td></tr></table>
    <div style="background:#ffffff;padding:16px">
      ${cards}
      <div style="font-size:13px;color:${CF.muted};padding:10px 4px 0;border-top:1px solid ${CF.line};margin-top:4px">
        The AI check is advisory — open the batch in CoreDocs to review, then reject or send for review.
      </div>
    </div>
  </div>`
}
