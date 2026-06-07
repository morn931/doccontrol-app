/**
 * Markup Extractor Service
 *
 * Replaces the Power Automate la-summarise-markups flow entirely.
 * Calls the Azure Function (PDF annotation extractor) directly, then
 * summarises via Azure OpenAI — all server-side, no external orchestrator.
 */

import { getGraphToken } from './graph'

// Full URL already includes /api/http_trigger1 — key is added as ?code= query param
const FUNCTION_URL       = process.env.PDF_ANNOTATION_FUNCTION_URL        ?? ''
const FUNCTION_KEY       = process.env.PDF_ANNOTATION_FUNCTION_KEY        ?? ''
const OPENAI_ENDPOINT    = process.env.AZURE_OPENAI_ENDPOINT               ?? ''
const OPENAI_DEPLOYMENT  = process.env.AZURE_OPENAI_REVIEW_SUMMARY_DEPLOYMENT ?? 'review-summary'
const OPENAI_API_KEY     = process.env.AZURE_OPENAI_API_KEY                ?? ''
const OPENAI_API_VERSION = '2024-02-15-preview'

// ─── Resolve SharePoint file coordinates from its full URL ────────────────────

interface SpFileCoords {
  siteUrl:   string
  driveId:   string
  filePath:  string   // path within the drive root, e.g. /K108 Battery.../file.pdf
}

let _driveIdCache: Record<string, string> = {}

async function resolveFileCoords(centralFileUrl: string): Promise<SpFileCoords | null> {
  if (!centralFileUrl) return null
  try {
    // Parse site URL and server-relative path from the full URL
    const url      = new URL(centralFileUrl)
    const pathParts = decodeURIComponent(url.pathname).split('/')
    // Typical path: /sites/DocumentControl/LibraryFolder/filename.pdf
    const sitesIdx = pathParts.indexOf('sites')
    if (sitesIdx < 0) return null
    const siteUrl = `${url.origin}/${pathParts.slice(0, sitesIdx + 2).join('/')}`

    const token  = await getGraphToken()
    // Encode URL for Graph shares endpoint
    const encoded = Buffer.from(centralFileUrl).toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem?$select=id,name,parentReference`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      console.warn('resolveFileCoords shares lookup failed:', res.status)
      return null
    }
    const item = await res.json()
    const driveId  = item.parentReference?.driveId as string | undefined
    const rawPath  = item.parentReference?.path as string | undefined // "/drive/root:/K108.../filename"
    const fileName = item.name as string

    if (!driveId || !rawPath) return null

    // Strip "/drive/root:" prefix to get the relative path
    const folderPath = rawPath.replace(/^\/drive\/root:/, '')
    const filePath   = `${folderPath}/${fileName}`

    return { siteUrl, driveId, filePath }
  } catch (e: any) {
    console.warn('resolveFileCoords error:', e.message)
    return null
  }
}

// ─── Step 1: Extract PDF annotations ─────────────────────────────────────────

async function extractPdfAnnotations(params: {
  siteUrl:    string
  driveId:    string
  filePath:   string
  docName:    string
  docUniqueId: string
  libraryName: string
}): Promise<string> {
  if (!FUNCTION_URL) return ''
  try {
    const body = {
      siteUrl:     params.siteUrl,
      driveId:     params.driveId,
      filePath:    params.filePath,
      docName:     params.docName,
      libraryName: params.libraryName,
      docUniqueId: params.docUniqueId,
      ignoreAnnotTypes:    ['Stamp'],
      ignoreTextContains:  [
        'Review outcome stamp has been affixed',
        'Review Outcome Source',
        'RDMC Aconex Workflow',
      ],
    }
    const url = FUNCTION_KEY ? `${FUNCTION_URL}?code=${FUNCTION_KEY}` : FUNCTION_URL
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn('PDF annotation extraction failed:', res.status)
      return ''
    }
    const data = await res.json()
    return (typeof data === 'object' ? data.notesText : String(data)) ?? ''
  } catch (e: any) {
    console.warn('PDF annotation extraction error:', e.message)
    return ''
  }
}

// ─── Step 2: Summarise with Azure OpenAI ─────────────────────────────────────

async function summariseMarkup(params: {
  docName:     string
  libraryName: string
  docUniqueId: string
  notesText:   string
}): Promise<string> {
  if (!OPENAI_ENDPOINT || !OPENAI_API_KEY) return ''
  try {
    const userPrompt = [
      `Document: ${params.docName}`,
      `Library: ${params.libraryName}`,
      `DocUniqueId: ${params.docUniqueId}`,
      '',
      'Instruction:',
      'Summarise reviewer mark-ups and comments for this document. Output concise bullet points.',
      'If notes are empty, return a short message saying no embedded mark-ups were detected.',
      '',
      'Extracted reviewer notes:',
      params.notesText || '(none)',
    ].join('\n')

    const res = await fetch(
      `${OPENAI_ENDPOINT}/openai/deployments/${OPENAI_DEPLOYMENT}/chat/completions?api-version=${OPENAI_API_VERSION}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': OPENAI_API_KEY },
        body: JSON.stringify({
          messages: [
            {
              role:    'system',
              content: 'You summarise engineering review feedback for a single document. Return concise bullet points. Only summarise what is supported by the extracted reviewer notes. Ignore boilerplate stamps or approval blocks if present. If no embedded mark-ups were detected, say so plainly.',
            },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
        }),
      }
    )
    if (!res.ok) {
      console.warn('OpenAI summarise failed:', res.status)
      return ''
    }
    const data = await res.json()
    return (data.choices?.[0]?.message?.content as string) ?? ''
  } catch (e: any) {
    console.warn('OpenAI summarise error:', e.message)
    return ''
  }
}

// ─── Public: extract + summarise for one document ────────────────────────────

export interface MarkupSummaryInput {
  centralFileUrl: string | null
  fileName:       string
  docName:        string | null
  docUniqueId:    string | null
  libraryName:    string | null
}

export async function getMarkupSummary(doc: MarkupSummaryInput): Promise<string> {
  const displayName = doc.docName || doc.fileName
  const uniqueId    = doc.docUniqueId || ''
  const library     = doc.libraryName || ''

  if (!doc.centralFileUrl) {
    return await summariseMarkup({ docName: displayName, libraryName: library, docUniqueId: uniqueId, notesText: '' })
  }

  const coords = await resolveFileCoords(doc.centralFileUrl)
  let notesText = ''

  if (coords) {
    notesText = await extractPdfAnnotations({
      siteUrl:     coords.siteUrl,
      driveId:     coords.driveId,
      filePath:    coords.filePath,
      docName:     displayName,
      docUniqueId: uniqueId,
      libraryName: library,
    })
  } else {
    console.warn(`getMarkupSummary: could not resolve SP coords for ${doc.fileName}`)
  }

  return await summariseMarkup({ docName: displayName, libraryName: library, docUniqueId: uniqueId, notesText })
}
