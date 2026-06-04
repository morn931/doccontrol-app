export const OUTCOME_CODES = {
  A1: { code: 'A1', text: 'Data Complete - No Comments - Do Not Resubmit',           severity: 1, color: 'green'  },
  D1: { code: 'D1', text: 'Received for Info Only - No Comment - Do Not Resubmit',   severity: 2, color: 'blue'   },
  B1: { code: 'B1', text: 'Data Complete - With Comments - Proceed - Resubmit',       severity: 3, color: 'yellow' },
  B2: { code: 'B2', text: 'Data Incomplete - With Comments - Proceed - Resubmit',     severity: 4, color: 'orange' },
  C1: { code: 'C1', text: 'Data Incomplete - With Comments - Hold Work - Resubmit',   severity: 5, color: 'red'    },
  Q1: { code: 'Q1', text: 'Quality is below Standard - Revise and Resubmit',          severity: 6, color: 'red'    },
  V1: { code: 'V1', text: 'Cancelled',                                                severity: 7, color: 'gray'   },
  S1: { code: 'S1', text: 'Superseded',                                               severity: 8, color: 'gray'   },
} as const

export type OutcomeCode = keyof typeof OUTCOME_CODES

export function worstOutcome(codes: OutcomeCode[]): OutcomeCode | null {
  if (!codes.length) return null
  return codes.reduce((worst, code) =>
    OUTCOME_CODES[code].severity > OUTCOME_CODES[worst].severity ? code : worst
  )
}

export function outcomeColorClass(code: OutcomeCode): string {
  const colorMap: Record<string, string> = {
    green:  'bg-green-100 text-green-800',
    blue:   'bg-blue-100 text-blue-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    orange: 'bg-orange-100 text-orange-800',
    red:    'bg-red-100 text-red-800',
    gray:   'bg-gray-100 text-gray-600',
  }
  return colorMap[OUTCOME_CODES[code].color] ?? 'bg-gray-100 text-gray-600'
}
