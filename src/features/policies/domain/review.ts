// Phase D (B6): scheduled policy review reminders. A policy carries a
// `review_due` date; once that date is reached it should be re-examined. This is
// the single, pure predicate the daily sweep uses to decide whether a policy is
// due for review. ISO dates (YYYY-MM-DD) compare correctly as strings, so no
// Date parsing is needed. A null `review_due` means the policy has no scheduled
// review and is never due.

export function isPolicyReviewDue(reviewDue: string | null, today: string): boolean {
  return reviewDue !== null && reviewDue <= today;
}
