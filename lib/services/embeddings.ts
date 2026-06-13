/**
 * Azure OpenAI embeddings — server-side only.
 *
 * Used for semantic document search over the AI summaries. Deploy an embeddings
 * model (text-embedding-3-small, 1536 dims) in Azure OpenAI and set the env var
 * AZURE_OPENAI_EMBEDDING_DEPLOYMENT to its deployment name.
 */
const ENDPOINT    = process.env.AZURE_OPENAI_ENDPOINT!
const API_KEY     = process.env.AZURE_OPENAI_API_KEY!
const DEPLOYMENT  = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small'
const API_VERSION = '2024-02-01'

export const EMBED_DIMS = 1536

/** Embed one or more texts → array of 1536-float vectors (same order as input). */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const res = await fetch(
    `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/embeddings?api-version=${API_VERSION}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
      body: JSON.stringify({ input: texts.map(t => (t || '').slice(0, 8000)) }),
    },
  )
  if (!res.ok) throw new Error(`Embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = await res.json()
  // Azure returns data sorted by index, but sort defensively.
  return (json.data as any[]).sort((a, b) => a.index - b.index).map(d => d.embedding as number[])
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embed([text]))[0]
}

/** Build the text we embed for a document — identity + classification + AI summary. */
export function buildEmbedText(row: {
  document_number?: string | null; document_title?: string | null
  discipline?: string | null; document_type?: string | null
  package_code?: string | null; ai_text?: string | null
}): string {
  return [
    row.document_number, row.document_title, row.package_code,
    row.discipline && `Discipline: ${row.discipline}`,
    row.document_type && `Type: ${row.document_type}`,
    row.ai_text,
  ].filter(Boolean).join('\n')
}
