import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { importWorkbook } from '@/lib/mddr/import'
import type { RegisterType } from '@/lib/mddr/mapping'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const db: any = createServiceClient()

  let form: FormData
  try { form = await req.formData() }
  catch { return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 }) }

  const file         = form.get('file') as File | null
  const registerType = (String(form.get('register_type') || 'SDDR').toUpperCase()) as RegisterType
  const formPackage  = String(form.get('package_code') || '').trim().toUpperCase() || null
  const formVendor   = String(form.get('vendor_name') || '').trim() || null
  const uploadMode   = (String(form.get('upload_mode') || 'merge')) as 'merge' | 'override'

  if (!file)  return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!['SDDR', 'CDDL', 'MDDR'].includes(registerType))
    return NextResponse.json({ error: 'Invalid register_type' }, { status: 400 })

  try {
    const buf = Buffer.from(await file.arrayBuffer())
    const result = await importWorkbook(db, buf, {
      registerType, formPackage, formVendor, uploadMode, fileName: file.name,
    })
    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
