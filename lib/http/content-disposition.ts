/**
 * Build a Content-Disposition header that cannot throw.
 *
 * HTTP header values are ByteStrings — every character must be <= 0xFF. A
 * filename carrying anything outside Latin-1 makes `new Response(...)` throw
 * "Cannot convert argument to a ByteString", which inside a try/catch reads as
 * a fetch failure and surfaces to the user as "could not load the document".
 *
 * Found in production 2026-09-03: 6105AK137-6280-EDTL-0004_С.pdf, whose
 * revision letter is a CYRILLIC С (U+0421) rather than a Latin C. The file was
 * in SharePoint, the URL resolved, the bytes downloaded — and the response died
 * on its own header, so two reviewers were blocked for two days on a document
 * the system could read perfectly well.
 *
 * RFC 6266/5987: send an ASCII-safe `filename` for old clients plus
 * `filename*=UTF-8''<percent-encoded>`, which every current browser prefers.
 */
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const clean = (filename || 'document').replace(/["\]/g, '').replace(/[\r\n]/g, ' ').trim() || 'document'
  // Latin-1-safe fallback: anything a header cannot carry becomes '_'.
  const ascii = clean.replace(/[^\x20-\x7E]/g, '_')
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`
}
