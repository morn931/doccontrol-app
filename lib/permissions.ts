import type { SupabaseClient } from '@supabase/supabase-js'

export const FK = {
  NAV_BATCHES:              'nav.batches',
  NAV_REVIEWS:              'nav.reviews',
  NAV_TRANSMITTALS:         'nav.transmittals',
  NAV_MDDR:                 'nav.mddr',
  NAV_REPORTING:            'nav.reporting',
  NAV_ADMIN:                'nav.admin',
  NAV_DOC_REQUESTS:         'nav.doc_requests',
  ACTION_REQUEST_DOC_NUMBER:'action.request_document_number',
  ACTION_ASSIGN_DOC_NUMBER: 'action.assign_document_number',
  ACTION_ASSIGN_REVIEWERS:  'action.assign_reviewers',
  ACTION_REJECT_BATCH:      'action.reject_batch',
  ACTION_GENERATE_TRANSMITTAL: 'action.generate_transmittal',
  ACTION_SUBMIT_REVIEW:     'action.submit_review',
  ACTION_UPLOAD_REGISTER:   'action.upload_register',
  ACTION_MDDR_SYNC:         'action.mddr_sync',
} as const

export type PermMap = Map<string, boolean>

export async function getPermissions(supabase: SupabaseClient): Promise<PermMap> {
  const { data } = await supabase
    .from('role_permissions')
    .select('feature_key, role, allowed')

  const map: PermMap = new Map()
  for (const row of (data ?? []) as { feature_key: string; role: string; allowed: boolean }[]) {
    map.set(`${row.feature_key}:${row.role}`, row.allowed)
  }
  return map
}

export function can(perms: PermMap, featureKey: string, role: string): boolean {
  if (role === 'developer') return true
  return perms.get(`${featureKey}:${role}`) ?? false
}
