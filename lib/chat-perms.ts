// Who may clear the Engineering Room history — Marnus, Morné, Liezl only.
// Checked BOTH client-side (to show the button) and server-side (to authorise
// the delete) — never trust the client alone.
export const CHAT_ADMINS = [
  'mornec@ppetech.co.za',
  'liezlc@ppetech.co.za',
  'marnusm@ppetech.co.za',
]

export function isChatAdmin(email: string | null | undefined): boolean {
  return !!email && CHAT_ADMINS.includes(email.toLowerCase())
}
