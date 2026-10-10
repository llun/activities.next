import { type Selectable } from 'kysely'
import { randomUUID } from 'node:crypto'

import type {
  AdminHashtag,
  CreateDomainAllowParams,
  CreateDomainBlockParams,
  DomainAllow,
  DomainBlock,
  DomainFederationRule,
  DomainFederationRuleStats,
  DomainFederationRuleType,
  GetAccountWithActorsParams,
  GetAccountWithActorsResult,
  GetAllAccountsParams,
  GetAllAccountsResult,
  GetAllHashtagsParams,
  GetAllHashtagsResult,
  GetDomainAllowsParams,
  GetDomainBlocksParams,
  GetServiceStatsBucketsParams,
  HashtagSortOrder,
  ImportDomainBlocksParams,
  ImportDomainBlocksResult,
  ServiceStats,
  ServiceStatsBucket,
  UpdateDomainBlockParams
} from '@/lib/database/domains/admin/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { getCounterValues } from '@/lib/database/kysely/counter'
import { getBucketStats } from '@/lib/database/kysely/counterBucket'
import type { Actors, DomainFederationRules } from '@/lib/database/kysely/db'
import { insertInChunks, selectInChunks } from '@/lib/database/kysely/inList'
import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import { toDomainAccount } from '@/lib/database/sql/utils/toDomainAccount'
import {
  DEFAULT_DOMAIN_BLOCK_SEVERITY,
  normalizeDomain
} from '@/lib/services/federation/domainRules'
import { ActorSettings, SQLAccount } from '@/lib/types/database/rows'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// Accounts

const ACCOUNT_COLUMNS = [
  'id',
  'email',
  'name',
  'iconUrl',
  'role',
  'createdAt',
  'updatedAt',
  'verifiedAt'
] as const

const ACTOR_COLUMNS = [
  'id',
  'publicId',
  'username',
  'domain',
  'name',
  'summary',
  'publicKey',
  'settings',
  'deletionStatus',
  'deletionScheduledAt',
  'createdAt',
  'updatedAt'
] as const

type ActorRow = Pick<Selectable<Actors>, (typeof ACTOR_COLUMNS)[number]>

// Counts and followers stay 0 and null: the admin views do not show them.
const toDomainActor = (row: ActorRow): Actor => {
  const settings = row.settings as ActorSettings | null
  return Actor.parse({
    id: row.id,
    publicId: row.publicId ?? null,
    username: row.username,
    domain: row.domain,
    name: row.name ?? undefined,
    summary: row.summary ?? undefined,
    iconUrl: settings?.iconUrl,
    headerImageUrl: settings?.headerImageUrl,
    manuallyApprovesFollowers: settings?.manuallyApprovesFollowers ?? true,
    followersUrl: settings?.followersUrl ?? '',
    inboxUrl: settings?.inboxUrl ?? '',
    sharedInboxUrl: settings?.sharedInboxUrl ?? '',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    publicKey: row.publicKey,
    // Nullable in the schema, but every writer sets both.
    createdAt: row.createdAt ?? 0,
    updatedAt: row.updatedAt ?? 0,
    deletionStatus: row.deletionStatus ?? null,
    deletionScheduledAt: row.deletionScheduledAt
  })
}

export const getAllAccounts = async (
  db: Db,
  { limit, offset }: GetAllAccountsParams
): Promise<GetAllAccountsResult> => {
  const [rows, total] = await Promise.all([
    db
      .selectFrom('accounts')
      .select(ACCOUNT_COLUMNS)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .offset(offset)
      .execute(),
    db
      .selectFrom('accounts')
      .select((eb) => eb.fn.count<number>('id').as('count'))
      .executeTakeFirstOrThrow()
  ])

  return {
    accounts: rows.map((row) => toDomainAccount(row as SQLAccount)),
    total: Number(total.count)
  }
}

export const getAccountWithActors = async (
  db: Db,
  { accountId }: GetAccountWithActorsParams
): Promise<GetAccountWithActorsResult | null> => {
  const account = await db
    .selectFrom('accounts')
    .select(ACCOUNT_COLUMNS)
    .where('id', '=', accountId)
    .limit(1)
    .executeTakeFirst()
  if (!account) return null

  const actors = await db
    .selectFrom('actors')
    .select(ACTOR_COLUMNS)
    .where('accountId', '=', accountId)
    .orderBy('createdAt', 'asc')
    .execute()

  return {
    account: toDomainAccount(account as SQLAccount),
    actors: actors.map(toDomainActor)
  }
}

// Service statistics

// The sum of the per-account counters `counterKey` names (every counter whose
// id starts with the key of an empty account id), hourly buckets excluded.
const sumAccountCounters = async (
  db: Db,
  counterKey: (accountId: string) => string
): Promise<number> => {
  const { total } = await db
    .selectFrom('counters')
    .select((eb) => eb.fn.sum<number | null>('value').as('total'))
    .where('id', 'like', `${counterKey('')}%`)
    .where('bucketHour', 'is', null)
    .executeTakeFirstOrThrow()
  return Number(total ?? 0)
}

export const getServiceStats = async (db: Db): Promise<ServiceStats> => {
  const [
    totals,
    totalMediaBytes,
    totalMediaFiles,
    totalFitnessBytes,
    totalFitnessFiles
  ] = await Promise.all([
    getCounterValues(db, [
      CounterKey.serviceTotalAccounts(),
      CounterKey.serviceTotalActors(),
      CounterKey.serviceTotalStatuses()
    ]),
    sumAccountCounters(db, CounterKey.mediaUsage),
    sumAccountCounters(db, CounterKey.totalMedia),
    sumAccountCounters(db, CounterKey.fitnessUsage),
    sumAccountCounters(db, CounterKey.totalFitness)
  ])

  return {
    totalAccounts: totals[CounterKey.serviceTotalAccounts()] ?? 0,
    totalActors: totals[CounterKey.serviceTotalActors()] ?? 0,
    totalStatuses: totals[CounterKey.serviceTotalStatuses()] ?? 0,
    totalMediaBytes,
    totalMediaFiles,
    totalFitnessBytes,
    totalFitnessFiles
  }
}

export const getServiceStatsBuckets = (
  db: Db,
  { counterType, startTime, endTime }: GetServiceStatsBucketsParams
): Promise<ServiceStatsBucket[]> =>
  getBucketStats(db, counterType, new Date(startTime), new Date(endTime))

// Hashtags

// The tags of public notes and polls, with the joins and filters shared by the
// page of hashtags and their total.
const publicHashtagTags = (db: Db) =>
  db
    .selectFrom('tags')
    .innerJoin('statuses', 'tags.statusId', 'statuses.id')
    .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
    .where('tags.type', '=', 'hashtag')
    .where('recipients.actorId', '=', ACTIVITY_STREAM_PUBLIC)
    .where('statuses.type', 'in', [StatusType.enum.Note, StatusType.enum.Poll])

const HASHTAG_ORDER = {
  alphabetical: [['tags.nameNormalized', 'asc']],
  recent: [
    ['latestPostAt', 'desc'],
    ['tags.nameNormalized', 'asc']
  ],
  count: [
    ['postCount', 'desc'],
    ['tags.nameNormalized', 'asc']
  ]
} as const satisfies Record<
  HashtagSortOrder,
  readonly (readonly [
    'tags.nameNormalized' | 'latestPostAt' | 'postCount',
    'asc' | 'desc'
  ])[]
>

export const getAllHashtags = async (
  db: Db,
  { limit, offset, sort }: GetAllHashtagsParams
): Promise<GetAllHashtagsResult> => {
  let page = publicHashtagTags(db)
    .groupBy('tags.nameNormalized')
    .select((eb) => [
      'tags.nameNormalized',
      eb.fn.count<number>('tags.statusId').distinct().as('postCount'),
      eb.fn.max('statuses.createdAt').as('latestPostAt')
    ])
  for (const [column, direction] of HASHTAG_ORDER[sort]) {
    page = page.orderBy(column, direction)
  }

  const [rows, total] = await Promise.all([
    page.limit(limit).offset(offset).execute(),
    publicHashtagTags(db)
      .select((eb) =>
        eb.fn.count<number>('tags.nameNormalized').distinct().as('count')
      )
      .executeTakeFirstOrThrow()
  ])

  const hashtags: AdminHashtag[] = rows.map((row) => ({
    // Preserve the full nameNormalized value as `name` so that routing
    // is fully reversible. The display layer strips the leading '#'.
    name: row.nameNormalized as string,
    postCount: Number(row.postCount),
    // An aggregate: SQLite hands it back undecoded.
    latestPostAt: toEpochMilliseconds(row.latestPostAt)
  }))

  return { hashtags, total: Number(total.count) }
}

// Domain federation rules (blocks and allows)

type RuleRow = Selectable<DomainFederationRules>

const toDomainBlock = (row: RuleRow): DomainBlock => ({
  id: row.id,
  domain: row.domain,
  type: 'block',
  severity:
    row.severity === 'noop' || row.severity === 'silence'
      ? row.severity
      : DEFAULT_DOMAIN_BLOCK_SEVERITY,
  rejectMedia: row.rejectMedia,
  rejectReports: row.rejectReports,
  privateComment: row.privateComment,
  publicComment: row.publicComment,
  obfuscate: row.obfuscate,
  source: row.source,
  // Nullable in the schema, but every writer sets both.
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

const toDomainAllow = (row: RuleRow): DomainAllow => ({
  id: row.id,
  domain: row.domain,
  type: 'allow',
  createdAt: row.createdAt ?? 0,
  updatedAt: row.updatedAt ?? 0
})

// What differs between the two kinds of rule: the `type` they are stored under
// and how a row maps to the domain object. Everything else is shared.
type RuleKind<Rule extends DomainFederationRule> = {
  type: DomainFederationRuleType
  toRule: (row: RuleRow) => Rule
}

const BLOCK: RuleKind<DomainBlock> = { type: 'block', toRule: toDomainBlock }
const ALLOW: RuleKind<DomainAllow> = { type: 'allow', toRule: toDomainAllow }

const normalizeOrThrow = (domain: string): string => {
  const normalized = normalizeDomain(domain)
  if (!normalized) throw new Error('Invalid domain')
  return normalized
}

const normalizeDomains = (domains: string[]): string[] => [
  ...new Set(
    domains
      .map((domain) => normalizeDomain(domain))
      .filter((domain): domain is string => domain !== null)
  )
]

// The rules that can apply to `domain`, most specific first: the domain itself,
// then its wildcard parents from the longest (`*.b.c` for `a.b.c`) to the
// shortest, then `*`.
const getDomainRuleCandidates = (domain: string): string[] => {
  if (domain === '*') return ['*']

  const parts = domain.split('.')
  const parentCandidates = parts
    .slice(1)
    .map((_, index) => parts.slice(index + 1).join('.'))
  const wildcardCandidates = parentCandidates.map(
    (candidate) => `*.${candidate}`
  )

  return [...new Set([domain, ...wildcardCandidates, '*'])]
}

const findRuleByDomain = (
  db: Db,
  type: DomainFederationRuleType,
  domain: string
) =>
  db
    .selectFrom('domain_federation_rules')
    .selectAll()
    .where('type', '=', type)
    .where('domain', '=', domain)
    .limit(1)
    .executeTakeFirst()

const getRuleById = async <Rule extends DomainFederationRule>(
  db: Db,
  { type, toRule }: RuleKind<Rule>,
  id: string
): Promise<Rule | null> => {
  const row = await db
    .selectFrom('domain_federation_rules')
    .selectAll()
    .where('id', '=', id)
    .where('type', '=', type)
    .limit(1)
    .executeTakeFirst()
  return row ? toRule(row) : null
}

const deleteRule = async <Rule extends DomainFederationRule>(
  db: Db,
  kind: RuleKind<Rule>,
  id: string
): Promise<Rule | null> => {
  const existing = await getRuleById(db, kind, id)
  if (!existing) return null

  // The id is unique and getRuleById has just matched the type with it.
  await db.deleteFrom('domain_federation_rules').where('id', '=', id).execute()
  return existing
}

// Rules ordered by domain, ascending. maxId pages toward larger domains
// ("next") and minId toward smaller ones ("prev", fetched descending then
// restored to ascending). sinceId returns the FIRST rows before the cursor,
// matching Mastodon since_id semantics. A cursor is a rule id; an unknown one
// applies no bound, and any cursor disables offset.
const listRules = async <Rule extends DomainFederationRule>(
  db: Db,
  { type, toRule }: RuleKind<Rule>,
  {
    limit = 100,
    offset = 0,
    severities,
    maxId,
    minId,
    sinceId
  }: GetDomainBlocksParams
): Promise<Rule[]> => {
  let query = db
    .selectFrom('domain_federation_rules')
    .selectAll()
    .where('type', '=', type)
    .limit(limit)

  // Block rows always persist a severity (only allow rows store null), so an
  // `in` filter cannot drop legacy rows.
  if (severities && severities.length > 0) {
    query = query.where('severity', 'in', severities)
  }

  const cursor = maxId
    ? ({ id: maxId, operator: '>', direction: 'asc' } as const)
    : minId
      ? ({ id: minId, operator: '<', direction: 'desc' } as const)
      : sinceId
        ? ({ id: sinceId, operator: '<', direction: 'asc' } as const)
        : null
  if (!cursor) {
    const rows = await query.orderBy('domain', 'asc').offset(offset).execute()
    return rows.map(toRule)
  }

  const cursorRule = await db
    .selectFrom('domain_federation_rules')
    .select('domain')
    .where('id', '=', cursor.id)
    .where('type', '=', type)
    .limit(1)
    .executeTakeFirst()
  if (cursorRule?.domain) {
    query = query.where('domain', cursor.operator, cursorRule.domain)
  }
  const rows = await query.orderBy('domain', cursor.direction).execute()
  return (cursor.direction === 'desc' ? rows.reverse() : rows).map(toRule)
}

// The rule that applies to `domain`: its own, else the longest wildcard parent,
// else `*`. Exact rules rank before wildcard ones, then longer before shorter,
// the same order getDomainRuleCandidates lists them in.
const getRuleForDomain = async <Rule extends DomainFederationRule>(
  db: Db,
  { type, toRule }: RuleKind<Rule>,
  domain: string
): Promise<Rule | null> => {
  const normalized = normalizeDomain(domain)
  if (!normalized) return null

  const row = await db
    .selectFrom('domain_federation_rules')
    .selectAll()
    .where('type', '=', type)
    .where('domain', 'in', getDomainRuleCandidates(normalized))
    .orderBy((eb) =>
      eb
        .case()
        .when(eb.or([eb('domain', '=', '*'), eb('domain', 'like', '*.%')]))
        .then(eb.lit(1))
        .else(eb.lit(0))
        .end()
    )
    .orderBy((eb) => eb.fn('length', ['domain']), 'desc')
    .limit(1)
    .executeTakeFirst()
  return row ? toRule(row) : null
}

// getRuleForDomain for a list of domains: a record from each normalized domain
// to its rule, or null when none applies.
const getRulesForDomains = async <Rule extends DomainFederationRule>(
  db: Db,
  { type, toRule }: RuleKind<Rule>,
  domains: string[]
): Promise<Record<string, Rule | null>> => {
  const normalizedDomains = normalizeDomains(domains)
  if (normalizedDomains.length === 0) return {}

  const candidatesByDomain = normalizedDomains.map(
    (domain) => [domain, getDomainRuleCandidates(domain)] as const
  )
  const rows = await selectInChunks(
    db,
    [...new Set(candidatesByDomain.flatMap(([, candidates]) => candidates))],
    (chunk) =>
      db
        .selectFrom('domain_federation_rules')
        .selectAll()
        .where('type', '=', type)
        .where('domain', 'in', chunk)
        .execute(),
    // The type.
    1
  )
  const rowsByDomain = new Map(rows.map((row) => [row.domain, row]))

  return Object.fromEntries(
    candidatesByDomain.map(([domain, candidates]) => {
      const row = candidates
        .map((candidate) => rowsByDomain.get(candidate))
        .find((match) => match !== undefined)
      return [domain, row ? toRule(row) : null]
    })
  )
}

export const getDomainBlocks = (db: Db, params: GetDomainBlocksParams = {}) =>
  listRules(db, BLOCK, params)

export const getDomainAllows = (db: Db, params: GetDomainAllowsParams = {}) =>
  listRules(db, ALLOW, params)

export const getDomainBlockById = (db: Db, id: string) =>
  getRuleById(db, BLOCK, id)

export const getDomainAllowById = (db: Db, id: string) =>
  getRuleById(db, ALLOW, id)

export const getDomainBlockForDomain = (db: Db, domain: string) =>
  getRuleForDomain(db, BLOCK, domain)

export const getDomainAllowForDomain = (db: Db, domain: string) =>
  getRuleForDomain(db, ALLOW, domain)

export const getDomainBlocksForDomains = (db: Db, domains: string[]) =>
  getRulesForDomains(db, BLOCK, domains)

export const getDomainAllowsForDomains = (db: Db, domains: string[]) =>
  getRulesForDomains(db, ALLOW, domains)

const countRules = async (
  db: Db,
  type: DomainFederationRuleType,
  severity?: string
): Promise<number> => {
  let query = db
    .selectFrom('domain_federation_rules')
    .select((eb) => eb.fn.count<number>('id').as('count'))
    .where('type', '=', type)
  if (severity) query = query.where('severity', '=', severity)
  return Number((await query.executeTakeFirstOrThrow()).count)
}

export const getDomainFederationRuleStats = async (
  db: Db
): Promise<DomainFederationRuleStats> => {
  const [blocks, suspendBlocks, silenceBlocks, allows, sourceRows] =
    await Promise.all([
      countRules(db, 'block'),
      countRules(db, 'block', DEFAULT_DOMAIN_BLOCK_SEVERITY),
      countRules(db, 'block', 'silence'),
      countRules(db, 'allow'),
      db
        .selectFrom('domain_federation_rules')
        .select((eb) => [
          eb.ref('source').$notNull().as('source'),
          eb.fn.count<number>('id').as('count')
        ])
        .where('type', '=', 'block')
        .where('source', 'is not', null)
        .groupBy('source')
        .execute()
    ])
  const sourceCounts = Object.fromEntries(
    sourceRows.map((row) => [row.source, Number(row.count)])
  )

  return {
    blocks,
    suspendBlocks,
    silenceBlocks,
    allows,
    sourceBlocks: Object.values(sourceCounts).reduce(
      (total, count) => total + count,
      0
    ),
    sourceCounts
  }
}

// A block row for `params`, its domain normalized. An import normalizes it
// before this too, and the stored domain is the one this returns: normalizeDomain
// is not idempotent for a domain ending in several dots.
const toBlockRow = (params: CreateDomainBlockParams, now: Date) => ({
  id: randomUUID(),
  domain: normalizeOrThrow(params.domain),
  type: 'block',
  severity: params.severity ?? DEFAULT_DOMAIN_BLOCK_SEVERITY,
  rejectMedia: params.rejectMedia ?? false,
  rejectReports: params.rejectReports ?? false,
  privateComment: params.privateComment ?? null,
  publicComment: params.publicComment ?? null,
  obfuscate: params.obfuscate ?? false,
  source: params.source ?? null,
  createdAt: now,
  updatedAt: now
})

// Inserts the blocks, or overwrites the settings of the block already stored
// under the same domain (keeping its id and createdAt). The rows must be for
// distinct domains.
const upsertBlocks = (db: Db, rows: ReturnType<typeof toBlockRow>[]) =>
  insertInChunks(
    db,
    rows,
    (chunk) =>
      db
        .insertInto('domain_federation_rules')
        .values(chunk)
        .onConflict((conflict) =>
          conflict.columns(['type', 'domain']).doUpdateSet((eb) => ({
            severity: eb.ref('excluded.severity'),
            rejectMedia: eb.ref('excluded.rejectMedia'),
            rejectReports: eb.ref('excluded.rejectReports'),
            privateComment: eb.ref('excluded.privateComment'),
            publicComment: eb.ref('excluded.publicComment'),
            obfuscate: eb.ref('excluded.obfuscate'),
            source: eb.ref('excluded.source'),
            updatedAt: eb.ref('excluded.updatedAt')
          }))
        )
        .execute(),
    500
  )

export const createDomainBlock = async (
  db: Db,
  params: CreateDomainBlockParams
): Promise<DomainBlock> => {
  const row = toBlockRow(params, new Date())
  await upsertBlocks(db, [row])

  const upserted = await findRuleByDomain(db, 'block', row.domain)
  if (!upserted) throw new Error('Failed to upsert domain block')
  return toDomainBlock(upserted)
}

export const updateDomainBlock = async (
  db: Db,
  params: UpdateDomainBlockParams
): Promise<DomainBlock | null> => {
  const existing = await getDomainBlockById(db, params.id)
  if (!existing) return null

  // The id is unique and getDomainBlockById has just matched the type with it.
  await db
    .updateTable('domain_federation_rules')
    .set({
      severity: params.severity ?? existing.severity,
      rejectMedia: params.rejectMedia ?? existing.rejectMedia,
      rejectReports: params.rejectReports ?? existing.rejectReports,
      // null clears a comment or the source; undefined leaves it alone.
      privateComment:
        params.privateComment === undefined
          ? existing.privateComment
          : params.privateComment,
      publicComment:
        params.publicComment === undefined
          ? existing.publicComment
          : params.publicComment,
      obfuscate: params.obfuscate ?? existing.obfuscate,
      source: params.source === undefined ? existing.source : params.source,
      updatedAt: new Date()
    })
    .where('id', '=', params.id)
    .execute()

  return getDomainBlockById(db, params.id)
}

export const deleteDomainBlock = (db: Db, id: string) =>
  deleteRule(db, BLOCK, id)

export const createDomainAllow = async (
  db: Db,
  { domain }: CreateDomainAllowParams
): Promise<DomainAllow> => {
  const normalized = normalizeOrThrow(domain)
  const now = new Date()

  // An allow is only a domain: no severity, comments or flags.
  await db
    .insertInto('domain_federation_rules')
    .values({
      id: randomUUID(),
      domain: normalized,
      type: 'allow',
      severity: null,
      rejectMedia: false,
      rejectReports: false,
      privateComment: null,
      publicComment: null,
      obfuscate: false,
      source: null,
      createdAt: now,
      updatedAt: now
    })
    .onConflict((conflict) => conflict.columns(['type', 'domain']).doNothing())
    .execute()

  const allow = await findRuleByDomain(db, 'allow', normalized)
  if (!allow) throw new Error('Failed to create domain allow')
  return toDomainAllow(allow)
}

export const deleteDomainAllow = (db: Db, id: string) =>
  deleteRule(db, ALLOW, id)

export const importDomainBlocks = async (
  db: Db,
  { blocks }: ImportDomainBlocksParams
): Promise<ImportDomainBlocksResult> => {
  let skipped = 0
  // A domain listed twice keeps its last block.
  const blocksByDomain = new Map<string, CreateDomainBlockParams>()
  for (const block of blocks) {
    const domain = normalizeDomain(block.domain)
    if (domain) blocksByDomain.set(domain, { ...block, domain })
    else skipped++
  }
  if (blocksByDomain.size === 0) return { created: 0, updated: 0, skipped }

  return inTransaction(db, async (trx) => {
    const existing = await selectInChunks(
      trx,
      [...blocksByDomain.keys()],
      (chunk) =>
        trx
          .selectFrom('domain_federation_rules')
          .select('domain')
          .where('type', '=', 'block')
          .where('domain', 'in', chunk)
          .execute(),
      // The type.
      1
    )
    const existingDomains = new Set(existing.map((row) => row.domain))

    const now = new Date()
    const rows = [...blocksByDomain.values()].map((block) =>
      toBlockRow(block, now)
    )
    const created = rows.filter((row) => !existingDomains.has(row.domain))
    await upsertBlocks(trx, rows)

    return {
      created: created.length,
      updated: rows.length - created.length,
      skipped
    }
  })
}

// The facade getSQLDatabase binds with bindDb().
export const adminQueries = {
  getAllAccounts,
  getAccountWithActors,
  getServiceStats,
  getServiceStatsBuckets,
  getAllHashtags,
  getDomainBlocks,
  getDomainAllows,
  getDomainBlockById,
  getDomainAllowById,
  getDomainBlockForDomain,
  getDomainBlocksForDomains,
  getDomainAllowForDomain,
  getDomainAllowsForDomains,
  getDomainFederationRuleStats,
  createDomainBlock,
  updateDomainBlock,
  deleteDomainBlock,
  createDomainAllow,
  deleteDomainAllow,
  importDomainBlocks
}
