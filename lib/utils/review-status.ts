/**
 * The review_tasks statuses that count as "actionable" for the currently signed-in
 * reviewer -- work sent to them that hasn't been actioned yet. 'pending' is excluded
 * (an earlier reviewer in the sequence hasn't finished, so it isn't this reviewer's
 * turn); 'completed' is excluded. Shared between /reviews and the Dashboard "My
 * Reviews" tile so the two counts can never drift apart.
 */
export const ACTIONABLE_REVIEW_STATUSES = ['sent', 'opened', 'in_progress', 'overdue'] as const
