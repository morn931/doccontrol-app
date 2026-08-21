/**
 * Rebuild a batch's signed PDF from its clean base, non-destructively: append the approval
 * block if the document has no title block, then stamp every SIGNED signatory at its stored
 * placement (or a sensible default). Shared by the sign route and the reposition route, so a
 * signer moving their signature just re-runs this. Writes the result back to signoff_pdf_url.
 */
import { getFileBytesByUrl, putFileBytesByUrl } from '@/lib/services/graph'
import {
  findTitleBlockColumns, rebuildSignedPdf, defaultPlacement, pageCountOf, pngFromDataUrl,
  type StampSpec, type SignatoryRow,
} from '@/lib/signoff-pdf'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rebuildBatchSignedPdf(db: any, batchId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: batch } = await db.from('batches')
    .select('id, internal_ref, signoff_pdf_url, signoff_base_url, document_versions(doc_name, file_name)')
    .eq('id', batchId).single()
  const b = batch as any
  if (!b?.signoff_pdf_url) return { ok: false, error: 'No sign-off PDF on this batch.' }

  // Prefer the clean base; fall back to the current PDF for batches created before base storage
  // (their next signoff/start will set a base).
  const baseUrl = b.signoff_base_url || b.signoff_pdf_url
  const base = await getFileBytesByUrl(baseUrl)
  const cols = await findTitleBlockColumns(base).catch(() => null)
  const basePageCount = await pageCountOf(base).catch(() => 1)

  const { data: tasks } = await db.from('signoff_tasks')
    .select('signatory_name, role_label, block_row, sequence_number, status, signed_at, signature_data, place_page, place_x, place_y, place_w, place_h, place_date_x, place_date_y')
    .eq('batch_id', batchId).order('sequence_number', { ascending: true })
  const all = (tasks ?? []) as any[]

  const stamps: StampSpec[] = all
    .filter((t) => t.status === 'signed')
    .map((t) => {
      const pl = (t.place_x != null && t.place_page != null)
        ? { page: t.place_page, x: t.place_x, y: t.place_y, w: t.place_w, h: t.place_h }
        : defaultPlacement(t.role_label, t.block_row ?? (t.sequence_number - 1), cols, basePageCount)
      return {
        ...pl,
        png: pngFromDataUrl(t.signature_data),
        typedName: t.signatory_name ?? undefined,
        dateStr: t.signed_at ? String(t.signed_at).slice(0, 10) : null,
        dateX: t.place_date_x ?? undefined,
        dateY: t.place_date_y ?? undefined,
      }
    })

  // Only append the approval block when the cover has no title block to sign in.
  const appendSignatories: SignatoryRow[] | null = cols
    ? null
    : all.map((t) => ({ name: t.signatory_name ?? '', role: t.role_label ?? '' }))

  const bytes = await rebuildSignedPdf(base, {
    appendSignatories,
    appendMeta: { title: b.document_versions?.[0]?.doc_name ?? b.document_versions?.[0]?.file_name, reference: b.internal_ref ?? undefined },
    stamps,
  })
  await putFileBytesByUrl(b.signoff_pdf_url, bytes)
  return { ok: true }
}
