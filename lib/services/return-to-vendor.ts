import { copyFileToVendorReturn } from './graph'

// In-app return-to-vendor — replaces the legacy Power Automate "Approver Picks" flow.
// The old flow only fired for batches that originated in the legacy SharePoint agent
// (they had an Approver Picks list row); batches created entirely in the new app had no
// such row, so generate-transmittal logged "new-app batch, skipping return trigger" and
// the reviewed files were NEVER copied to the vendor — the transmittal email went out but
// the documents never reached the vendor's cloud. Doing the copy in-app makes the app the
// single, observable, version-controlled owner of the return for EVERY batch.

export type VendorReturnResult = {
  ok: boolean            // every document copied, none failed, at least one sent
  total: number          // document versions on the batch
  copied: number
  failed: number
  skipped: number        // versions with no central_file_url to copy
  errors: string[]
  returnLibrary?: string
  reason?: string
}

/**
 * Copy a batch's reviewed documents into the vendor's return library (their own SharePoint
 * site — "TO VENDOR" / "TO ICTS" per the package's vendor_sites row) and stamp each
 * version's returned_at + returned_file_url. Best-effort per document: one failure does
 * not abort the rest, and the caller decides how to reflect partial success (the transmittal
 * is only marked "returned" when every document copies).
 */
export async function returnBatchFilesToVendor(db: any, batch: any): Promise<VendorReturnResult> {
  const errors: string[] = []

  // Where does THIS vendor's return library live? (authoritative per-package source of truth)
  let siteUrl: string | null = null
  let returnLib = '/TO VENDOR'
  if (batch.package_id) {
    const { data: vs } = await db.from('vendor_sites')
      .select('site_url, return_library').eq('package_id', batch.package_id).eq('active', true).maybeSingle()
    if (vs?.site_url) siteUrl = vs.site_url
    if (vs?.return_library) returnLib = vs.return_library
  }
  if (!siteUrl) siteUrl = batch.source_site_url ?? null
  if (!siteUrl) {
    return { ok: false, total: 0, copied: 0, failed: 0, skipped: 0,
             errors: ['No vendor site configured for this package (vendor_sites row missing).'], reason: 'no_site' }
  }

  // The reviewed copies to send back = the DocumentControl central files (they carry any
  // in-app mark-ups written back during review).
  const { data: dvs } = await db.from('document_versions')
    .select('id, file_name, central_file_url').eq('batch_id', batch.id)
  const all = dvs ?? []
  const docs = all.filter((d: any) => d.central_file_url && d.file_name)

  const lib = returnLib.replace(/^\/+/, '')
  const nowIso = new Date().toISOString()
  let copied = 0, failed = 0
  for (const d of docs) {
    try {
      const { webUrl } = await copyFileToVendorReturn(d.central_file_url, siteUrl, lib, d.file_name)
      await db.from('document_versions').update({ returned_file_url: webUrl || null, returned_at: nowIso }).eq('id', d.id)
      copied++
    } catch (e: any) {
      failed++
      errors.push(`${d.file_name}: ${e?.message ?? String(e)}`)
    }
  }
  const skipped = all.length - docs.length
  if (skipped) errors.push(`${skipped} document(s) had no stored file to return.`)

  return {
    ok: failed === 0 && skipped === 0 && copied > 0,
    total: all.length, copied, failed, skipped, errors,
    returnLibrary: `${siteUrl.replace(/\/+$/, '')}/${lib}`,
  }
}
