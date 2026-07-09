import { Knex } from 'knex'
import { randomUUID } from 'node:crypto'

import {
  CounterKey,
  getCounterValues,
  parseCounterValue
} from '@/lib/database/sql/utils/counter'
import { getBucketStats } from '@/lib/database/sql/utils/counterBucket'
import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { toDomainAccount } from '@/lib/database/sql/utils/toDomainAccount'
import {
  DEFAULT_DOMAIN_BLOCK_SEVERITY,
  normalizeDomain
} from '@/lib/services/federation/domainRules'
import {
  AdminDatabase,
  AdminHashtag,
  CreateDomainBlockParams,
  DomainAllow,
  DomainBlock,
  DomainFederationRuleType,
  GetAccountWithActorsParams,
  GetAllAccountsParams,
  GetAllHashtagsParams,
  GetServiceStatsBucketsParams,
  HashtagSortOrder,
  UpdateDomainBlockParams
} from '@/lib/types/database/operations'
import {
  ActorSettings,
  SQLAccount,
  SQLActor,
  SQLDomainFederationRule
} from '@/lib/types/database/rows'
import { Actor } from '@/lib/types/domain/actor'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const toDomainActor = (row: SQLActor): Actor => {
  const settings = getCompatibleJSON<ActorSettings>(row.settings)
  return Actor.parse({
    id: row.id,
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
    createdAt: getCompatibleTime(row.createdAt),
    updatedAt: getCompatibleTime(row.updatedAt),
    deletionStatus: row.deletionStatus ?? null,
    deletionScheduledAt:
      row.deletionScheduledAt != null
        ? getCompatibleTime(row.deletionScheduledAt)
        : null
  })
}

const toBoolean = (value: boolean | number | undefined | null): boolean =>
  value === true || value === 1

const toDomainBlock = (row: SQLDomainFederationRule): DomainBlock => ({
  id: row.id,
  domain: row.domain,
  type: 'block' as const,
  severity:
    row.severity === 'noop' || row.severity === 'silence'
      ? row.severity
      : DEFAULT_DOMAIN_BLOCK_SEVERITY,
  rejectMedia: toBoolean(row.rejectMedia),
  rejectReports: toBoolean(row.rejectReports),
  privateComment: row.privateComment ?? null,
  publicComment: row.publicComment ?? null,
  obfuscate: toBoolean(row.obfuscate),
  source: row.source ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

const toDomainAllow = (row: SQLDomainFederationRule): DomainAllow => ({
  id: row.id,
  domain: row.domain,
  type: 'allow' as const,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

const normalizeOrThrow = (domain: string): string => {
  const normalized = normalizeDomain(domain)
  if (!normalized) throw new Error('Invalid domain')
  return normalized
}

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

const normalizeDomains = (domains: string[]): string[] => [
  ...new Set(
    domains
      .map((domain) => normalizeDomain(domain))
      .filter((domain): domain is string => domain !== null)
  )
]

const compareDomainRuleRows = (
  left: SQLDomainFederationRule,
  right: SQLDomainFederationRule
) => {
  if (left.domain === right.domain) return 0
  if (left.domain === '*') return 1
  if (right.domain === '*') return -1

  const wildcardDiff =
    Number(left.domain.startsWith('*.')) - Number(right.domain.startsWith('*.'))
  if (wildcardDiff !== 0) return wildcardDiff

  const lengthDiff = right.domain.length - left.domain.length
  if (lengthDiff !== 0) return lengthDiff

  return 0
}

const resolveDomainRuleMatches = <T extends DomainBlock | DomainAllow>(
  domains: string[],
  rows: SQLDomainFederationRule[],
  toDomainRule: (row: SQLDomainFederationRule) => T
): Record<string, T | null> => {
  const sortedRows = [...rows].sort(compareDomainRuleRows)

  return Object.fromEntries(
    domains.map((domain) => {
      const candidates = new Set(getDomainRuleCandidates(domain))
      const row =
        sortedRows.find((candidate) => candidates.has(candidate.domain)) ?? null

      return [domain, row ? toDomainRule(row) : null]
    })
  )
}

const SQL_BATCH_SIZE = 500

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }

  return chunks
}

const getDomainRuleCandidateRows = async (
  database: Knex,
  type: DomainFederationRuleType,
  domains: string[]
): Promise<SQLDomainFederationRule[]> => {
  const candidates = [...new Set(domains.flatMap(getDomainRuleCandidates))]
  const rows: SQLDomainFederationRule[] = []

  for (const domainChunk of chunkArray(candidates, SQL_BATCH_SIZE)) {
    const chunkRows = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where('type', type)
      .whereIn('domain', domainChunk)
    rows.push(...chunkRows)
  }

  return rows
}

const buildDomainBlockInsert = (
  params: CreateDomainBlockParams,
  now: Date,
  id = randomUUID()
) => ({
  id,
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

const buildDomainBlockUpdate = (
  params: UpdateDomainBlockParams | CreateDomainBlockParams,
  now: Date
) => ({
  severity: params.severity ?? DEFAULT_DOMAIN_BLOCK_SEVERITY,
  rejectMedia: params.rejectMedia ?? false,
  rejectReports: params.rejectReports ?? false,
  privateComment: params.privateComment ?? null,
  publicComment: params.publicComment ?? null,
  obfuscate: params.obfuscate ?? false,
  source: params.source ?? null,
  updatedAt: now
})

export const AdminSQLDatabaseMixin = (database: Knex): AdminDatabase => ({
  async getAllAccounts({ limit, offset }: GetAllAccountsParams) {
    const [rows, countResult] = await Promise.all([
      database<SQLAccount>('accounts')
        .select(
          'id',
          'email',
          'name',
          'iconUrl',
          'role',
          'createdAt',
          'updatedAt',
          'verifiedAt'
        )
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset),
      database('accounts').count<{ count: string }>('id as count').first()
    ])

    return {
      accounts: (rows as SQLAccount[]).map(toDomainAccount),
      total: parseInt(countResult?.count ?? '0', 10)
    }
  },

  async getAccountWithActors({ accountId }: GetAccountWithActorsParams) {
    const accountRow = await database<SQLAccount>('accounts')
      .select(
        'id',
        'email',
        'name',
        'iconUrl',
        'role',
        'createdAt',
        'updatedAt',
        'verifiedAt'
      )
      .where('id', accountId)
      .first()
    if (!accountRow) return null

    const actorRows = await database<SQLActor>('actors')
      .select(
        'id',
        'username',
        'domain',
        'name',
        'summary',
        'accountId',
        'publicKey',
        'settings',
        'deletionStatus',
        'deletionScheduledAt',
        'createdAt',
        'updatedAt'
      )
      .where('accountId', accountId)
      .orderBy('createdAt', 'asc')

    return {
      account: toDomainAccount(accountRow as SQLAccount),
      actors: (actorRows as SQLActor[]).map(toDomainActor)
    }
  },

  async getServiceStats() {
    const [
      counterMap,
      mediaResult,
      mediaFilesResult,
      fitnessResult,
      fitnessFilesResult
    ] = await Promise.all([
      getCounterValues(database, [
        CounterKey.serviceTotalAccounts(),
        CounterKey.serviceTotalActors(),
        CounterKey.serviceTotalStatuses()
      ]),
      database('counters')
        .where('id', 'like', 'media-usage:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'total-media:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'fitness-usage:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first(),
      database('counters')
        .where('id', 'like', 'total-fitness:%')
        .whereNull('bucketHour')
        .sum<{ total: string }>('value as total')
        .first()
    ])

    return {
      totalAccounts: parseCounterValue(
        counterMap[CounterKey.serviceTotalAccounts()]
      ),
      totalActors: parseCounterValue(
        counterMap[CounterKey.serviceTotalActors()]
      ),
      totalStatuses: parseCounterValue(
        counterMap[CounterKey.serviceTotalStatuses()]
      ),
      totalMediaBytes: parseInt(mediaResult?.total ?? '0', 10),
      totalMediaFiles: parseInt(mediaFilesResult?.total ?? '0', 10),
      totalFitnessBytes: parseInt(fitnessResult?.total ?? '0', 10),
      totalFitnessFiles: parseInt(fitnessFilesResult?.total ?? '0', 10)
    }
  },

  async getServiceStatsBuckets({
    counterType,
    startTime,
    endTime
  }: GetServiceStatsBucketsParams) {
    const rows = await getBucketStats(
      database,
      counterType,
      new Date(startTime),
      new Date(endTime)
    )
    return rows.map((row) => ({
      bucketHour: row.bucketHour.getTime(),
      value: row.value
    }))
  },

  async getAllHashtags({ limit, offset, sort }: GetAllHashtagsParams) {
    // baseQuery holds only the shared joins and filters; aggregations are
    // applied separately so the count query doesn't duplicate this logic.
    const baseQuery = () =>
      database('tags')
        .innerJoin('statuses', 'tags.statusId', 'statuses.id')
        .innerJoin('recipients', 'statuses.id', 'recipients.statusId')
        .where('tags.type', 'hashtag')
        .where('recipients.actorId', ACTIVITY_STREAM_PUBLIC)
        .whereIn('statuses.type', [StatusType.enum.Note, StatusType.enum.Poll])

    const orderColumns: Record<
      HashtagSortOrder,
      { column: string; order: string }[]
    > = {
      alphabetical: [{ column: 'tags.nameNormalized', order: 'asc' }],
      recent: [
        { column: 'latestPostAt', order: 'desc' },
        { column: 'tags.nameNormalized', order: 'asc' }
      ],
      count: [
        { column: 'postCount', order: 'desc' },
        { column: 'tags.nameNormalized', order: 'asc' }
      ]
    }

    const [rows, countResult] = await Promise.all([
      baseQuery()
        .groupBy('tags.nameNormalized')
        .select('tags.nameNormalized')
        .countDistinct({ postCount: 'tags.statusId' })
        .max({ latestPostAt: 'statuses.createdAt' })
        .orderBy(orderColumns[sort])
        .limit(limit)
        .offset(offset),
      baseQuery()
        .countDistinct<{ count: string }>({ count: 'tags.nameNormalized' })
        .first()
    ])

    const hashtags: AdminHashtag[] = (
      rows as {
        nameNormalized: string
        postCount: string
        latestPostAt: Date | string | number | null
      }[]
    ).map((row) => ({
      // Preserve the full nameNormalized value as `name` so that routing
      // is fully reversible. The display layer strips the leading '#'.
      name: row.nameNormalized,
      postCount: parseInt(String(row.postCount), 10),
      latestPostAt:
        row.latestPostAt != null ? new Date(row.latestPostAt).getTime() : null
    }))

    return {
      hashtags,
      total: parseInt(String(countResult?.count ?? '0'), 10)
    }
  },

  async getDomainBlocks({ limit = 100, offset = 0, severities } = {}) {
    const query = database<SQLDomainFederationRule>('domain_federation_rules')
      .where('type', 'block')
      .orderBy('domain', 'asc')
      .limit(limit)
      .offset(offset)

    // Block rows always persist a severity (only allow rows store null), so a
    // whereIn filter cannot drop legacy rows.
    if (severities && severities.length > 0) {
      query.whereIn('severity', severities)
    }

    const rows = await query

    return rows.map(toDomainBlock)
  },

  async getDomainAllows({ limit = 100, offset = 0 } = {}) {
    const rows = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where('type', 'allow')
      .orderBy('domain', 'asc')
      .limit(limit)
      .offset(offset)

    return rows.map(toDomainAllow)
  },

  async getDomainBlockById(id: string) {
    const row = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where({ id, type: 'block' })
      .first()

    return row ? toDomainBlock(row) : null
  },

  async getDomainAllowById(id: string) {
    const row = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where({ id, type: 'allow' })
      .first()

    return row ? toDomainAllow(row) : null
  },

  async getDomainBlockForDomain(domain: string) {
    const normalized = normalizeDomain(domain)
    if (!normalized) return null

    const row = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where('type', 'block')
      .whereIn('domain', getDomainRuleCandidates(normalized))
      .orderByRaw(
        "case when domain = '*' or domain like '*.%' then 1 else 0 end asc"
      )
      .orderByRaw('length(domain) DESC')
      .first()

    return row ? toDomainBlock(row) : null
  },

  async getDomainBlocksForDomains(domains: string[]) {
    const normalizedDomains = normalizeDomains(domains)
    if (normalizedDomains.length === 0) return {}

    const rows = await getDomainRuleCandidateRows(
      database,
      'block',
      normalizedDomains
    )

    return resolveDomainRuleMatches(normalizedDomains, rows, toDomainBlock)
  },

  async getDomainAllowForDomain(domain: string) {
    const normalized = normalizeDomain(domain)
    if (!normalized) return null

    const row = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where('type', 'allow')
      .whereIn('domain', getDomainRuleCandidates(normalized))
      .orderByRaw(
        "case when domain = '*' or domain like '*.%' then 1 else 0 end asc"
      )
      .orderByRaw('length(domain) DESC')
      .first()

    return row ? toDomainAllow(row) : null
  },

  async getDomainAllowsForDomains(domains: string[]) {
    const normalizedDomains = normalizeDomains(domains)
    if (normalizedDomains.length === 0) return {}

    const rows = await getDomainRuleCandidateRows(
      database,
      'allow',
      normalizedDomains
    )

    return resolveDomainRuleMatches(normalizedDomains, rows, toDomainAllow)
  },

  async getDomainFederationRuleStats() {
    const [
      blockCount,
      suspendBlockCount,
      silenceBlockCount,
      allowCount,
      sourceRows
    ] = await Promise.all([
      database('domain_federation_rules')
        .where('type', 'block')
        .count<{ count: string | number }>('id as count')
        .first(),
      database('domain_federation_rules')
        .where({
          type: 'block',
          severity: DEFAULT_DOMAIN_BLOCK_SEVERITY
        })
        .count<{ count: string | number }>('id as count')
        .first(),
      database('domain_federation_rules')
        .where({
          type: 'block',
          severity: 'silence'
        })
        .count<{ count: string | number }>('id as count')
        .first(),
      database('domain_federation_rules')
        .where('type', 'allow')
        .count<{ count: string | number }>('id as count')
        .first(),
      database('domain_federation_rules')
        .select('source')
        .where('type', 'block')
        .whereNotNull('source')
        .groupBy('source')
        .count<{ source: string; count: string | number }>('id as count')
    ])
    const sourceCounts = Object.fromEntries(
      (
        sourceRows as unknown as {
          source: string
          count: string | number
        }[]
      ).map((row) => [row.source, Number(row.count)])
    )
    const sourceBlocks = Object.values(sourceCounts).reduce(
      (total, count) => total + count,
      0
    )

    return {
      blocks: Number(blockCount?.count ?? 0),
      suspendBlocks: Number(suspendBlockCount?.count ?? 0),
      silenceBlocks: Number(silenceBlockCount?.count ?? 0),
      allows: Number(allowCount?.count ?? 0),
      sourceBlocks,
      sourceCounts
    }
  },

  async createDomainBlock(params) {
    const now = new Date()
    const row = buildDomainBlockInsert(params, now)

    await database('domain_federation_rules')
      .insert(row)
      .onConflict(['type', 'domain'])
      .merge(buildDomainBlockUpdate(params, now))

    const upserted = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where({ type: 'block', domain: row.domain })
      .first()
    if (!upserted) throw new Error('Failed to upsert domain block')
    return toDomainBlock(upserted)
  },

  async updateDomainBlock(params) {
    const existing = await this.getDomainBlockById(params.id)
    if (!existing) return null

    await database<SQLDomainFederationRule>('domain_federation_rules')
      .where({ id: params.id, type: 'block' })
      .update({
        severity: params.severity ?? existing.severity,
        rejectMedia: params.rejectMedia ?? existing.rejectMedia,
        rejectReports: params.rejectReports ?? existing.rejectReports,
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

    return this.getDomainBlockById(params.id)
  },

  async deleteDomainBlock(id: string) {
    const existing = await this.getDomainBlockById(id)
    if (!existing) return null

    await database('domain_federation_rules')
      .where({ id, type: 'block' })
      .delete()
    return existing
  },

  async createDomainAllow({ domain }) {
    const normalized = normalizeOrThrow(domain)
    const now = new Date()
    const row = {
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
    }

    await database('domain_federation_rules')
      .insert(row)
      .onConflict(['type', 'domain'])
      .ignore()

    const upserted = await database<SQLDomainFederationRule>(
      'domain_federation_rules'
    )
      .where({ type: 'allow', domain: normalized })
      .first()
    if (!upserted) throw new Error('Failed to create domain allow')
    return toDomainAllow(upserted)
  },

  async deleteDomainAllow(id: string) {
    const existing = await this.getDomainAllowById(id)
    if (!existing) return null

    await database('domain_federation_rules')
      .where({ id, type: 'allow' })
      .delete()
    return existing
  },

  async importDomainBlocks({ blocks }) {
    let created = 0
    let updated = 0
    let skipped = 0
    const normalizedBlocks = new Map<string, CreateDomainBlockParams>()

    blocks.forEach((block) => {
      const normalized = normalizeDomain(block.domain)
      if (!normalized) {
        skipped++
        return
      }

      normalizedBlocks.set(normalized, { ...block, domain: normalized })
    })

    const normalizedDomains = [...normalizedBlocks.keys()]
    if (normalizedDomains.length === 0) {
      return { created, updated, skipped }
    }

    await database.transaction(async (trx) => {
      const existingDomains = new Set<string>()
      for (const domainChunk of chunkArray(normalizedDomains, SQL_BATCH_SIZE)) {
        const rows = await trx<SQLDomainFederationRule>(
          'domain_federation_rules'
        )
          .select('domain')
          .where('type', 'block')
          .whereIn('domain', domainChunk)

        rows.forEach((row) => existingDomains.add(row.domain))
      }

      const now = new Date()
      const rows = [...normalizedBlocks.values()].map((block) =>
        buildDomainBlockInsert(block, now)
      )
      created = rows.filter((row) => !existingDomains.has(row.domain)).length
      updated = rows.length - created

      for (const rowChunk of chunkArray(rows, SQL_BATCH_SIZE)) {
        await trx('domain_federation_rules')
          .insert(rowChunk)
          .onConflict(['type', 'domain'])
          .merge([
            'severity',
            'rejectMedia',
            'rejectReports',
            'privateComment',
            'publicComment',
            'obfuscate',
            'source',
            'updatedAt'
          ])
      }
    })

    return { created, updated, skipped }
  }
})
