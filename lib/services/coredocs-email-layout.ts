/**
 * The ONE shared CoreDocs email wrapper. Every notification (review required/complete,
 * new batch, batch rejected, vendor transmittal, document-number request/allocation,
 * etc.) renders through this function so all CoreDocs email looks the same and is
 * Outlook-desktop-safe:
 *   - table-based layout, no CSS classes for structural formatting
 *   - critical styling inline (Outlook strips/ignores much of a <style> block)
 *   - Calibri first, Arial/sans-serif fallback
 *   - max width ~640px, light slate/grey outer background
 *   - navy header strip, Coreflow logo left / PPE logo right (inline via CID,
 *     natural aspect ratio preserved, matching visual height -- never stretched)
 *   - full, uncropped slate/light industrial hero directly below the header,
 *     rendered as a plain <img> at a fixed width with height left to scale
 *     proportionally (never cropped/zoomed/background-sized)
 *   - thin teal rule below the hero
 *   - navy heading, grey metadata block, pale-blue instruction callout, teal CTA
 *   - muted footer
 *
 * Images are referenced via cid: and are attached inline by lib/coreflow-mail.ts'
 * sendMail() (which auto-attaches whichever of coreflowlogo/ppelogo/coreflowhero the
 * HTML actually references), so Outlook never depends on remote image loading.
 */

const CALIBRI = "Calibri, Arial, sans-serif"

export function renderCoreDocsEmail(opts: {
  title: string
  heading: string
  bodyHtml: string
  cta?: { href: string; label: string }
}): string {
  const btnRow = opts.cta
    ? `<tr><td style="padding-top:14px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td bgcolor="#008CA8" style="border-radius:6px;mso-padding-alt:11px 22px;">
            <a href="${opts.cta.href}" style="display:inline-block;padding:11px 22px;font-family:${CALIBRI};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${opts.cta.label}</a>
          </td>
        </tr></table>
      </td></tr>`
    : ''

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef1f5;font-family:${CALIBRI};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef1f5;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background-color:#ffffff;">

  <!-- Header strip: Coreflow logo left, PPE logo right -->
  <tr><td bgcolor="#F1F5F9" style="background-color:#F1F5F9;padding:8px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" valign="middle">
        <img src="cid:coreflowlogo" width="66" height="44" alt="Coreflow" style="display:block;border:0;outline:none;text-decoration:none;height:44px;width:66px;">
      </td>
      <td align="right" valign="middle">
        <img src="cid:ppelogo" width="44" height="44" alt="PPE Technologies" style="display:block;border:0;outline:none;text-decoration:none;height:44px;width:44px;">
      </td>
    </tr></table>
  </td></tr>

  <!-- Hero: full, uncropped slate/light industrial artwork, proportional scaling only -->
  <tr><td style="line-height:0;font-size:0;">
    <img src="cid:coreflowhero" width="640" alt=""
      style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;">
  </td></tr>

  <!-- Thin teal rule -->
  <tr><td bgcolor="#00B8C4" style="background-color:#00B8C4;line-height:3px;font-size:3px;">&nbsp;</td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 30px 8px 30px;font-family:${CALIBRI};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>
      <h1 style="margin:0 0 16px 0;color:#1B3464;font-family:${CALIBRI};font-size:19px;font-weight:700;">${opts.heading}</h1>
    </td></tr>
    <tr><td style="color:#374151;font-family:${CALIBRI};font-size:14px;line-height:1.6;">
      ${opts.bodyHtml}
    </td></tr>
    ${btnRow}
    </table>
  </td></tr>

  <tr><td style="padding:8px 30px 26px 30px;">&nbsp;</td></tr>

  <!-- Footer -->
  <tr><td bgcolor="#f7f9fb" style="background-color:#f7f9fb;border-top:1px solid #edf0f3;padding:16px 30px;">
    <p style="margin:0;color:#9aa4b2;font-family:${CALIBRI};font-size:11px;line-height:1.5;">
      Automated message from <span style="color:#1B3464;font-weight:700;">Coreflow</span> — CoreDocs. Please don't reply to this address.<br>
      Coreflow · project delivery platform · <a href="https://coreflow.build" style="color:#0097A3;text-decoration:none;">coreflow.build</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

/** A grey metadata block rendered as a table -- label column left, value column right. */
export function metaTable(rows: Array<[label: string, valueHtml: string]>): string {
  const trs = rows.map(([label, value]) => `
    <tr>
      <td style="padding:5px 8px;font-family:${CALIBRI};font-size:13px;font-weight:700;color:#6B7280;white-space:nowrap;width:140px;vertical-align:top;border-top:1px solid #E5E7EB;">${label}</td>
      <td style="padding:5px 8px;font-family:${CALIBRI};font-size:13px;color:#374151;vertical-align:top;border-top:1px solid #E5E7EB;word-break:break-word;">${value}</td>
    </tr>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;border:1px solid #E5E7EB;border-radius:6px;margin:20px 0;">
    <tr><td style="padding:6px 8px 0 8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>
    </td></tr>
  </table>`
}

/** Pale-blue instruction callout. */
export function calloutBlock(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#EFF6FF;border-radius:0 6px 6px 0;margin:16px 0;">
    <tr>
      <td width="4" bgcolor="#3B82F6" style="background-color:#3B82F6;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:12px 16px;font-family:${CALIBRI};font-size:13px;color:#1E40AF;">${html}</td>
    </tr>
  </table>`
}

/** Red/danger variant of the callout (rejection reasons etc). */
export function dangerCalloutBlock(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FEF2F2;border-radius:0 6px 6px 0;margin:16px 0;">
    <tr>
      <td width="4" bgcolor="#EF4444" style="background-color:#EF4444;font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:12px 16px;font-family:${CALIBRI};font-size:13px;color:#991B1B;">${html}</td>
    </tr>
  </table>`
}

/** Teal CTA button, for use inline within body HTML (same visual style as the
 *  top-level `cta` option on renderCoreDocsEmail). */
export function ctaButtonHtml(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;"><tr>
    <td bgcolor="#008CA8" style="border-radius:6px;mso-padding-alt:11px 24px;">
      <a href="${href}" style="display:inline-block;padding:11px 24px;font-family:${CALIBRI};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>
    </td>
  </tr></table>`
}
