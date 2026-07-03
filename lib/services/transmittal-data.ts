import { OUTCOME_CODES } from '@/lib/utils/outcome-codes'

// Shared transmittal data assembly — rebuilds the per-document reviewer outcomes
// (incl. captured in-app mark-up comments) for a batch, for the read-only view.
// The generate-transmittal route holds the PDF builder; this is the data only.

const SEVERITY: Record<string, number> = { A1: 1, D1: 2, B1: 3, B2: 4, C1: 5, Q1: 6, V1: 7, S1: 8 }

export function worstCode(codes: string[]): string {
  return codes.filter(Boolean).sort((a, b) => (SEVERITY[b] ?? 0) - (SEVERITY[a] ?? 0))[0] ?? 'A1'
}
export function outcomeText(code: string): string {
  return (OUTCOME_CODES as any)[code]?.text ?? code
}

export type TransmittalReviewer = { name: string; code: string; comment: string }
export type TransmittalDoc = {
  fileName: string; docName: string | null; revision: string | null
  discipline: string | null; documentType: string | null; topic: string | null
  outcomeCode: string; reviewers: TransmittalReviewer[]
}

function composeComment(outcomeComment: string | null, captured?: string[]): string {
  const parts: string[] = []
  if (outcomeComment) parts.push(outcomeComment)
  if (captured?.length) parts.push('Mark-ups: ' + captured.join('; '))
  return parts.join('\n')
}

async function capturedCommentMap(db: any, dvIds: string[]): Promise<Record<string, string[]>> {
  if (!dvIds.length) return {}
  const { data } = await db.from('document_markups')
    .select('document_version_id, author_email, comments').in('document_version_id', dvIds)
  const map: Record<string, string[]> = {}
  for (const m of data ?? []) {
    const texts = Array.isArray(m.comments) ? m.comments.map((c: any) => String(c?.text ?? '').trim()).filter(Boolean) : []
    if (texts.length) map[`${m.document_version_id}::${m.author_email}`] = texts
  }
  return map
}

export async function assembleTransmittalDocs(db: any, batchId: string): Promise<{ documents: TransmittalDoc[]; overallCode: string }> {
  const { data: docVersions } = await db.from('document_versions')
    .select('id, file_name, doc_name, revision, discipline, document_type, topic')
    .eq('batch_id', batchId)
  const dvs = docVersions ?? []

  const { data: allTasks } = await db.from('review_tasks')
    .select('document_version_id, reviewer_email, review_outcome_code, comment, sequence_number')
    .eq('batch_id', batchId).eq('status', 'completed').order('sequence_number', { ascending: true })

  const emails = [...new Set((allTasks ?? []).map((t: any) => t.reviewer_email as string))]
  const { data: users } = await db.from('users').select('email, full_name').in('email', emails)
  const nameMap: Record<string, string> = {}
  for (const u of users ?? []) { if (u.email) nameMap[u.email] = u.full_name ?? u.email.split('@')[0] }

  const tasksByDv: Record<string, any[]> = {}
  for (const t of allTasks ?? []) { (tasksByDv[t.document_version_id] ??= []).push(t) }

  const capMap = await capturedCommentMap(db, dvs.map((d: any) => d.id))

  const documents: TransmittalDoc[] = dvs.map((dv: any) => {
    const tasks = tasksByDv[dv.id] ?? []
    const outCode = worstCode(tasks.map((t: any) => t.review_outcome_code).filter(Boolean)) || 'A1'
    return {
      fileName: dv.file_name, docName: dv.doc_name, revision: dv.revision,
      discipline: dv.discipline, documentType: dv.document_type, topic: dv.topic,
      outcomeCode: outCode,
      reviewers: tasks.map((t: any) => ({
        name: nameMap[t.reviewer_email] ?? t.reviewer_email.split('@')[0],
        code: t.review_outcome_code ?? '—',
        comment: composeComment(t.comment, capMap[`${dv.id}::${t.reviewer_email}`]),
      })),
    }
  })

  const overallCode = worstCode(documents.map(d => d.outcomeCode)) || 'A1'
  return { documents, overallCode }
}
