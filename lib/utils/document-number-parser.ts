/**
 * Parses vendor document file names into structured components.
 * Common pattern: 6105AK137-6280-CFND-0005_A.pdf
 *   -> normalizedDocNumber: 6105AK137-6280-CFND-0005
 *   -> revision:            A
 *
 * Falls back to using the full filename (without extension) as the document number
 * and flags the record for manual review.
 */
export interface ParsedDocumentNumber {
  normalizedDocumentNumber: string
  displayDocumentNumber:    string
  revision:                 string | null
  revisionSort:             string | null
  parseSuccess:             boolean
  parseWarning?:            string
}

export function parseDocumentFileName(fileName: string): ParsedDocumentNumber {
  // Strip extension
  const withoutExt = fileName.replace(/\.[^.]+$/, '')

  // Primary pattern: anything_REVISION (last underscore + alphanumeric suffix)
  const match = withoutExt.match(/^(.+)_([A-Z0-9]{1,4})$/)

  if (match) {
    const [, docNumber, revision] = match
    return {
      normalizedDocumentNumber: docNumber.trim(),
      displayDocumentNumber:    docNumber.trim(),
      revision:                 revision,
      revisionSort:             revisionToSort(revision),
      parseSuccess:             true,
    }
  }

  // Fallback: no underscore-revision pattern
  return {
    normalizedDocumentNumber: withoutExt,
    displayDocumentNumber:    withoutExt,
    revision:                 null,
    revisionSort:             null,
    parseSuccess:             false,
    parseWarning:             `Could not parse revision from filename: ${fileName}`,
  }
}

/** Convert revision to a sortable string: A->A, B->B, 01->01 etc */
function revisionToSort(revision: string): string {
  // If purely numeric, zero-pad to 4 digits
  if (/^\d+$/.test(revision)) {
    return revision.padStart(4, '0')
  }
  return revision.toUpperCase()
}

/** Compare two revision strings. Returns negative if a < b */
export function compareRevisions(a: string | null, b: string | null): number {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  const sa = revisionToSort(a)
  const sb = revisionToSort(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}
