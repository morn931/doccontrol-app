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
 * RFC 6266/5987: an ASCII-safe `filename` for old clients plus
 * `filename*=UTF-8''<percent-encoded>`, which every current browser prefers.
 */
const UNSAFE_IN_QUOTES = /[^\x20-\x7E]|["\\]/g; // non-Latin-1, quote or backslash
const CONTROL = /[\r\n\t]/g;

export function contentDisposition(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const clean = (filename || "document").replace(CONTROL, " ").trim() || "document";
  // Latin-1-safe fallback for old clients: anything a header cannot carry, and
  // the quoting characters, become '_'.
  const ascii = clean.replace(UNSAFE_IN_QUOTES, "_");
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}
