// Split a stored recipient string (comma/semicolon/whitespace separated) into a clean,
// de-duplicated list of email addresses. Used wherever a setting may hold several emails.
export function splitEmails(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  return String(raw)
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s && s.includes('@') && !seen.has(s.toLowerCase()) && (seen.add(s.toLowerCase()), true))
}

export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
}
