import { Mastodon } from '@/lib/types/activitypub'
import { Report } from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

// The user-facing Report entity returned by POST /api/v1/reports (and the
// reporter's own report views). Shared so `action_taken`/`action_taken_at`
// reflect the real workflow columns instead of being hardcoded null.
export const serializeReportEntity = ({
  report,
  targetAccount
}: {
  report: Report
  targetAccount: Mastodon.Account
}) => ({
  id: report.id,
  action_taken: report.actionTaken,
  action_taken_at: report.actionTakenAt
    ? getISOTimeUTC(report.actionTakenAt)
    : null,
  category: report.category,
  comment: report.comment,
  forwarded: report.forward,
  created_at: getISOTimeUTC(report.createdAt),
  // Echo ids back in the Mastodon short form clients sent, not the internal
  // URL form we persist.
  status_ids: report.statusIds.map((id) => urlToId(id)),
  rule_ids: report.ruleIds,
  collection_ids: report.collectionIds,
  target_account: targetAccount
})
