import { Database } from '@/lib/database/types'
import { hydrateAdminAccounts } from '@/lib/services/admin/serializeAdminAccounts'
import { getMastodonStatuses } from '@/lib/services/mastodon/getMastodonStatus'
import { Mastodon } from '@/lib/types/activitypub'
import { Report } from '@/lib/types/database/operations'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { urlToId } from '@/lib/utils/urlToId'

// Hydrate a batch of reports into Admin::Report entities: the four embedded
// Admin::Accounts (reporter, target, assigned, action-taken-by), the reported
// statuses, and the referenced instance rules.
export const serializeAdminReports = async (
  database: Database,
  reports: Report[],
  moderatorActorId?: string
): Promise<Mastodon.AdminReport[]> => {
  if (reports.length === 0) return []

  // 1. Embedded accounts.
  const actorIds = [
    ...new Set(
      reports.flatMap((report) =>
        [
          report.actorId,
          report.targetActorId,
          report.assignedActorId,
          report.actionTakenByActorId
        ].filter((id): id is string => Boolean(id))
      )
    )
  ]
  const records = await database.getAdminAccountRecords({ actorIds })
  const adminAccounts = await hydrateAdminAccounts(database, records)
  const accountByMastodonId = new Map(
    adminAccounts.map((account) => [account.id, account])
  )
  const accountByActorId = new Map(
    records
      .map((record): [string, Mastodon.AdminAccount | undefined] => [
        record.actor.id,
        accountByMastodonId.get(urlToId(record.actor.id))
      ])
      .filter((entry): entry is [string, Mastodon.AdminAccount] =>
        Boolean(entry[1])
      )
  )

  // 2. Reported statuses.
  const statusIds = [...new Set(reports.flatMap((report) => report.statusIds))]
  const domainStatuses = statusIds.length
    ? await database.getStatusesByIds({ statusIds })
    : []
  const mastodonStatuses = await getMastodonStatuses(
    database,
    domainStatuses,
    moderatorActorId
  )
  const statusByMastodonId = new Map(
    mastodonStatuses.map((status) => [status.id, status])
  )

  // 3. Instance rules.
  const rules = await database.getInstanceRules()
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]))

  return reports.flatMap((report) => {
    const account = accountByActorId.get(report.actorId)
    const targetAccount = accountByActorId.get(report.targetActorId)
    // account and target_account are required by the entity; a report whose
    // reporter or target actor is not resolvable is unserializable — skip it
    // rather than emit a malformed entity.
    if (!account || !targetAccount) return []

    return [
      Mastodon.AdminReport.parse({
        id: report.id,
        action_taken: report.actionTaken,
        action_taken_at: report.actionTakenAt
          ? getISOTimeUTC(report.actionTakenAt)
          : null,
        category: report.category,
        comment: report.comment,
        forwarded: report.forward,
        created_at: getISOTimeUTC(report.createdAt),
        updated_at: getISOTimeUTC(report.updatedAt),
        account,
        target_account: targetAccount,
        assigned_account: report.assignedActorId
          ? (accountByActorId.get(report.assignedActorId) ?? null)
          : null,
        action_taken_by_account: report.actionTakenByActorId
          ? (accountByActorId.get(report.actionTakenByActorId) ?? null)
          : null,
        statuses: report.statusIds
          .map((statusId) => statusByMastodonId.get(urlToId(statusId)))
          .filter((status): status is Mastodon.Status => Boolean(status)),
        rules: report.ruleIds
          .map((ruleId) => ruleById.get(ruleId))
          .filter((rule): rule is (typeof rules)[number] => Boolean(rule))
          .map((rule) => ({ id: rule.id, text: rule.text, hint: rule.hint }))
      })
    ]
  })
}
