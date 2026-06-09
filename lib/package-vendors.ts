/**
 * Awarded vendor per package (the appointed Service Provider / Originator).
 * Captured from PPE's award status. PPE's own engineering = K124.
 * Packages not listed here are treated as "Not awarded yet".
 */
export const PACKAGE_VENDOR: Record<string, string> = {
  E102: 'ABB',
  E511B: 'ABB',
  E516B: 'ABB',
  E518B: 'ABB',
  K125: 'Siemens',
  K137: 'PSI',
  E123: 'Crestchic',
  E101: 'Orient',
  K103: 'Wartsila',
  E113: 'Fuelco',
  ICTS: 'PRDW',
  'ICT-S': 'PRDW',
  K124: 'PPE',          // PPE's own engineering deliverables
}

export const NOT_AWARDED = 'Not awarded yet'

export function awardedVendor(code?: string | null): string {
  if (!code) return NOT_AWARDED
  return PACKAGE_VENDOR[code] ?? PACKAGE_VENDOR[code.toUpperCase()] ?? NOT_AWARDED
}
