'use client'
import { useRef } from 'react'
import PdfMarkup from '@/components/markup/pdf-markup'
import RoutingButtons, { type Routing } from './routing-buttons'

type MarkupApi = { jumpTo: (c: any) => void; hasMarks?: () => boolean; saveToSharePoint?: () => Promise<boolean> }

// Composes the markup editor and the before-tender bar so the bar can reach INTO the editor:
// "To drawing office" / "To Lead" first flatten whatever is drawn on the canvas into the
// working copy (the same thing ☁ Save to SharePoint does), so the file that gets emailed and
// the file in the session folder always carry the marks — the test on 7 Sep sent a clean
// file because the room had drawn but never pressed save.
export default function PrelimMarkup({ docId, fileName, myColor, readOnly, routing }: {
  docId: string; fileName: string; myColor: string; readOnly: boolean
  routing: { routing: Routing | null; routingTo: string | null; routingToEmail: string | null; routingAt: string | null; routingBy: string | null; mailedAt: string | null; attached: boolean | null; error: string | null; open: boolean; canManage: boolean; tenderCopyUrl: string | null; tenderCopyName: string | null; tenderStampError: string | null }
}) {
  const apiRef = useRef<MarkupApi | null>(null)
  const beforeSend = async (): Promise<true | string> => {
    const api = apiRef.current
    if (!api?.saveToSharePoint) return true
    if (api.hasMarks && !api.hasMarks()) return true
    const ok = await api.saveToSharePoint()
    return ok ? true : 'Could not save the marks into the file — nothing was sent. Try ☁ Save to SharePoint, then send again.'
  }
  return (
    <PdfMarkup src={`/api/prelim/documents/${docId}/file`} fileName={fileName} endpointBase={`/api/prelim/documents/${docId}`} initialColor={myColor} readOnly={readOnly}
      exposeApi={(api) => { apiRef.current = api as MarkupApi }}
      toolbarExtra={<RoutingButtons docId={docId} {...routing} beforeSend={beforeSend} />} />
  )
}
