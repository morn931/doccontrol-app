/**
 * Azure Document Intelligence (Form Recognizer) Service
 * Server-side only. Extracts text from documents using the prebuilt-read model.
 */

const ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT!
const API_KEY  = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY!
// CoreFlow's coreflow-docintel resource requires the modern API version (2023-07-31
// returns 404 on the /documentintelligence path); prebuilt-read schema is unchanged.
const API_VERSION = '2024-11-30'

export interface DocumentIntelligenceResult {
  extractedText: string
  pageCount: number
  confidence: number
}

/**
 * Extract text from a document using Azure Document Intelligence.
 * Accepts a URL (SharePoint download URL) or raw file content as ArrayBuffer.
 */
export async function extractDocumentText(
  sourceUrl: string
): Promise<DocumentIntelligenceResult> {
  // Submit analysis job
  const submitRes = await fetch(
    `${ENDPOINT}/documentintelligence/documentModels/prebuilt-read:analyze?api-version=${API_VERSION}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ urlSource: sourceUrl }),
    }
  )

  if (!submitRes.ok) {
    throw new Error(`Document Intelligence submit failed: ${await submitRes.text()}`)
  }

  const operationLocation = submitRes.headers.get('Operation-Location')
  if (!operationLocation) throw new Error('No Operation-Location header in response')

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const pollRes = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': API_KEY },
    })
    const pollData = await pollRes.json()

    if (pollData.status === 'succeeded') {
      const pages   = pollData.analyzeResult?.pages ?? []
      const content = pollData.analyzeResult?.content ?? ''
      const avgConf = pages.reduce((sum: number, p: any) =>
        sum + (p.words?.reduce((s: number, w: any) => s + (w.confidence ?? 0), 0) / (p.words?.length || 1)), 0
      ) / Math.max(pages.length, 1)

      return {
        extractedText: content,
        pageCount:     pages.length,
        confidence:    Math.round(avgConf * 100) / 100,
      }
    }

    if (pollData.status === 'failed') {
      throw new Error(`Document Intelligence analysis failed: ${JSON.stringify(pollData.error)}`)
    }
  }

  throw new Error('Document Intelligence timed out after 90 seconds')
}
