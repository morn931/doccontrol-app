/**
 * Azure OpenAI Service
 * Server-side only. Classifies and summarises documents for document control.
 */

const ENDPOINT   = process.env.AZURE_OPENAI_ENDPOINT!
const API_KEY    = process.env.AZURE_OPENAI_API_KEY!
const INTAKE_DEPLOYMENT = process.env.AZURE_OPENAI_INTAKE_DEPLOYMENT!
const API_VERSION = '2024-02-01'

export interface DocumentClassification {
  docName:      string
  discipline:   string
  documentType: string
  topic:        string
  summary:      string
  rawAiText:    string
}

const DISCIPLINES = ['Electrical','Instrumentation','Automation','Mechanical','Civil','Commercial','Not sure']
const DOC_TYPES   = [
  'Specification','Drawing','Calculation','Datasheet','Template','RFI',
  'Contract Notice','Change Request','Variation/VO','Delay Notice','EOT Request',
  'Claim','Dispute/Reservation of Rights','Commercial Letter','Not sure',
]
const TOPICS = ['Technical','SHERQ','Contractual','Not sure']

export async function classifyDocument(
  extractedText: string,
  fileName: string,
  vendorName: string,
  packageName: string
): Promise<DocumentClassification> {
  const systemPrompt = `You are a document control AI for an EPCM engineering company.
Classify the provided document and return a structured response with exactly these headings:
DockName: [document title as it appears in the document]
Discipline: [one of: ${DISCIPLINES.join(' | ')}]
DocumentType: [one of: ${DOC_TYPES.join(' | ')}]
Topic: [one of: ${TOPICS.join(' | ')}]
Summary: [concise summary - see rules below]

Rules:
- Support both engineering documents AND contractual/commercial notifications.
- If the document is an RFI, Change Request, Delay Notice, Claim, Commercial Letter, or similar, classify Topic as Contractual.
- Do NOT include legal boilerplate, confidentiality notices, email footers, distribution lists, or signature blocks in the summary.
- Technical summaries: focus on scope, equipment, purpose, design parameters, and limits.
- Contractual summaries must identify:
  1. Type of notice/request
  2. What the sender is requesting/asserting/notifying
  3. Deadlines, response dates, or time-bar requirements
  4. Cost and/or schedule impact if stated
  5. Contract references, PO numbers, or clause references if stated
  6. Action required from PPE/RDMC
- Keep the summary under 200 words.`

  const userPrompt = `Vendor: ${vendorName}
Package: ${packageName}
File name: ${fileName}

Document text (first 4000 characters):
${extractedText.slice(0, 4000)}`

  const res = await fetch(
    `${ENDPOINT}/openai/deployments/${INTAKE_DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`,
    {
      method: 'POST',
      headers: {
        'api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens:  600,
      }),
    }
  )

  if (!res.ok) throw new Error(`OpenAI request failed: ${await res.text()}`)
  const data = await res.json()
  const rawText: string = data.choices?.[0]?.message?.content ?? ''

  return parseClassification(rawText, fileName)
}

function parseClassification(raw: string, fileName: string): DocumentClassification {
  const get = (key: string): string => {
    const match = raw.match(new RegExp(`${key}:\s*(.+?)(?=\n[A-Z]|$)`, 'is'))
    return match?.[1]?.trim() ?? ''
  }

  const discipline   = normalise(get('Discipline'),   DISCIPLINES)
  const documentType = normalise(get('DocumentType'), DOC_TYPES)
  const topic        = normalise(get('Topic'),        TOPICS)

  return {
    docName:      get('DockName') || fileName.replace(/\.[^.]+$/, ''),
    discipline:   discipline || 'Not sure',
    documentType: documentType || 'Not sure',
    topic:        topic || 'Not sure',
    summary:      get('Summary'),
    rawAiText:    raw,
  }
}

function normalise(value: string, allowed: string[]): string {
  if (!value) return ''
  const v = value.toLowerCase().trim()
  return allowed.find(a => a.toLowerCase() === v) ??
         allowed.find(a => v.includes(a.toLowerCase())) ?? ''
}
