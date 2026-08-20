import { createClient } from '@supabase/supabase-js'
import { graphFetch } from '@/lib/services/graph'

// Meeting Prep — upcoming meetings in the next 48h for the signed-in engineer,
// so they get a heads-up (and, later, an AI pre-brief) before walking in.
// Sources, both FAIL SOFT so the cockpit never breaks on either:
//   • Outlook calendar via Microsoft Graph (primary) — needs the Graph app to
//     have Calendars.Read (application) admin-consented; 401/403 → graphAuthorised=false.
//   • CoreMeeting (shared Supabase cm_meeting) — supplementary; day-granular date,
//     mostly used for minutes today, so upcoming rows may be sparse ("not yet
//     fully operational") — included so it lights up as CoreMeeting grows.

export type MeetingItem = {
  source: 'outlook' | 'coremeeting'
  id: string
  title: string
  start: string | null   // ISO datetime (outlook) or 'YYYY-MM-DD' (coremeeting)
  end: string | null
  allDay: boolean
  organizer: string | null
  attendees: string[]    // display names, capped
  attendeeCount: number
  joinUrl: string | null
  online: boolean
  packageHint: string | null  // extracted package token, e.g. K125 / E102 / K124A
  category: string | null
}

export type UpcomingMeetings = {
  meetings: MeetingItem[]
  /** false = the Graph calendar read was refused (Calendars.Read consent likely missing) */
  graphAuthorised: boolean
}

const HINT = /\b([KE]\d{2,3}[A-Z]?)\b/i
function pkgHint(...s: (string | null | undefined)[]): string | null {
  for (const x of s) { const m = x && HINT.exec(x); if (m) return m[1].toUpperCase() }
  return null
}

function sharedClient() {
  const url = process.env.CORETIME_SUPABASE_URL
  const key = process.env.CORETIME_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getCalendarView(email: string, startISO: string, endISO: string): Promise<{ ok: boolean; events: any[] }> {
  try {
    const qs = new URLSearchParams({
      startDateTime: startISO, endDateTime: endISO,
      $select: 'subject,start,end,organizer,attendees,onlineMeeting,isCancelled,isAllDay,location',
      $orderby: 'start/dateTime', $top: '25',
    })
    const res = await graphFetch(`/users/${encodeURIComponent(email)}/calendarView?${qs.toString()}`, {
      headers: { Prefer: 'outlook.timezone="UTC"' },
    })
    if (!res.ok) return { ok: res.status !== 401 && res.status !== 403, events: [] }
    const j = await res.json()
    return { ok: true, events: Array.isArray(j.value) ? j.value : [] }
  } catch {
    return { ok: true, events: [] } // network hiccup ≠ "unauthorised"; don't nag about consent
  }
}

async function getCoreMeetingUpcoming(email: string, fromDay: string, toDay: string): Promise<MeetingItem[]> {
  const db = sharedClient()
  if (!db) return []
  try {
    const { data: mtgs } = await db.from('cm_meeting')
      .select('id, title, date, category, subcategory, organizer_email, teams_meeting_id, teams_recording_url')
      .gte('date', fromDay).lte('date', toDay).limit(100)
    if (!mtgs?.length) return []
    const ids = mtgs.map((m) => m.id as string)
    const { data: att } = await db.from('cm_meeting_attendee').select('meeting_id, user_email').in('meeting_id', ids)
    const mine = new Set((att ?? []).filter((a) => String(a.user_email).toLowerCase() === email.toLowerCase()).map((a) => a.meeting_id as string))
    const count = new Map<string, number>()
    for (const a of att ?? []) count.set(a.meeting_id as string, (count.get(a.meeting_id as string) ?? 0) + 1)
    return mtgs
      .filter((m) => mine.has(m.id as string) || String(m.organizer_email ?? '').toLowerCase() === email.toLowerCase())
      .map((m) => ({
        source: 'coremeeting' as const,
        id: `cm:${m.id}`,
        title: (m.title as string) ?? 'Meeting',
        start: (m.date as string) ?? null,
        end: null,
        allDay: true,
        organizer: (m.organizer_email as string) ?? null,
        attendees: [],
        attendeeCount: count.get(m.id as string) ?? 0,
        joinUrl: null,
        online: !!m.teams_meeting_id,
        packageHint: pkgHint(m.subcategory as string, m.title as string),
        category: (m.category as string) ?? null,
      }))
  } catch {
    return []
  }
}

export async function getUpcomingMeetings(email: string): Promise<UpcomingMeetings> {
  if (!email) return { meetings: [], graphAuthorised: true }
  const now = new Date()
  const end = new Date(now.getTime() + 48 * 3600 * 1000)
  const [cal, cm] = await Promise.all([
    getCalendarView(email, now.toISOString(), end.toISOString()),
    getCoreMeetingUpcoming(email, now.toISOString().slice(0, 10), end.toISOString().slice(0, 10)),
  ])

  const outlook: MeetingItem[] = (cal.events)
    .filter((e) => !e.isCancelled)
    .map((e, i) => {
      const attendees = (e.attendees ?? [])
        .map((a: { emailAddress?: { name?: string; address?: string } }) => a.emailAddress?.name || a.emailAddress?.address || '')
        .filter(Boolean)
      return {
        source: 'outlook' as const,
        id: `ol:${e.id ?? i}`,
        title: (e.subject as string) ?? '(no subject)',
        start: e.start?.dateTime ? `${e.start.dateTime}Z`.replace(/Z+$/, 'Z') : null,
        end: e.end?.dateTime ? `${e.end.dateTime}Z`.replace(/Z+$/, 'Z') : null,
        allDay: !!e.isAllDay,
        organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || null,
        attendees: attendees.slice(0, 5),
        attendeeCount: attendees.length,
        joinUrl: e.onlineMeeting?.joinUrl ?? null,
        online: !!e.onlineMeeting,
        packageHint: pkgHint(e.subject as string, e.location?.displayName as string),
        category: null,
      }
    })

  // Dedupe: an Outlook event and a CoreMeeting row for the same meeting — prefer
  // Outlook (it carries the time). Match on normalised title + same day.
  const key = (m: MeetingItem) => `${(m.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40)}|${(m.start || '').slice(0, 10)}`
  const seen = new Set(outlook.map(key))
  const merged = [...outlook, ...cm.filter((m) => !seen.has(key(m)))]

  merged.sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'))
  return { meetings: merged.slice(0, 8), graphAuthorised: cal.ok }
}
