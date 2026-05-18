#!/usr/bin/env -S node -r @swc-node/register
import { loadEnvConfig } from '@next/env'
import { parseArgs as parseNodeArgs } from 'node:util'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
  configureMeilisearchIndex,
  deleteMeilisearchDocuments,
  writeMeilisearchDocuments
} from '@/lib/search/meilisearch'
import type {
  MeilisearchDocument,
  MeilisearchType
} from '@/lib/search/meilisearch'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const Backend = z.enum(['database', 'meilisearch', 'all'])
type Backend = z.infer<typeof Backend>

const CliArgs = z.object({
  backend: Backend.default('database'),
  clear: z.boolean().default(false),
  batchSize: z.number().int().positive().default(500),
  dryRun: z.boolean().default(false)
})
type CliArgs = z.infer<typeof CliArgs>

const USAGE = `Usage:
  yarn search:reindex [--backend database|meilisearch|all] [--clear] [--batch-size <n>] [--dry-run]

Examples:
  yarn search:reindex --backend database --clear
  ACTIVITIES_SEARCH_BACKEND=meilisearch yarn search:reindex --backend meilisearch --clear
  yarn search:reindex --backend all --batch-size 1000`

type SearchDocumentRow = {
  id: string
  entityType: 'account' | 'status' | 'hashtag'
  entityId: string
  actorId: string | null
  visibility: string | null
  searchText: string | null
  entityCreatedAt: Date | string | number | null
}

const parseBooleanFlag = (key: string, value?: string) => {
  if (value === undefined) return true
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`Invalid value for --${key}: ${value}. Use true or false.`)
}

const BOOLEAN_OPTIONS = new Set(['clear', 'dry-run'])

const normalizeCliArgs = (args: string[]) => {
  const normalizedArgs: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith('--')) {
      normalizedArgs.push(arg)
      continue
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    if (!BOOLEAN_OPTIONS.has(rawKey)) {
      normalizedArgs.push(arg)
      continue
    }

    const nextValue = args[index + 1]
    const flagEnabled =
      inlineValue !== undefined
        ? parseBooleanFlag(rawKey, inlineValue)
        : nextValue && !nextValue.startsWith('--')
          ? parseBooleanFlag(rawKey, nextValue)
          : parseBooleanFlag(rawKey)
    if (inlineValue === undefined && nextValue && !nextValue.startsWith('--')) {
      index += 1
    }
    if (flagEnabled) {
      normalizedArgs.push(`--${rawKey}`)
    }
  }

  return normalizedArgs
}

export const parseArgs = (args: string[]): CliArgs => {
  const parsed = parseNodeArgs({
    args: normalizeCliArgs(args),
    options: {
      backend: { type: 'string' },
      clear: { type: 'boolean' },
      'batch-size': { type: 'string' },
      'dry-run': { type: 'boolean' }
    },
    strict: true,
    allowPositionals: false
  }).values

  return CliArgs.parse({
    backend: parsed.backend,
    clear: Boolean(parsed.clear),
    batchSize: parsed['batch-size'] ? Number(parsed['batch-size']) : undefined,
    dryRun: Boolean(parsed['dry-run'])
  })
}

const isHelpRequest = (args: string[]) =>
  args.some((arg) => arg === '--help' || arg === '-h')

const toMeilisearchType = (
  entityType: SearchDocumentRow['entityType']
): MeilisearchType => {
  switch (entityType) {
    case 'account':
      return 'accounts'
    case 'status':
      return 'statuses'
    case 'hashtag':
      return 'hashtags'
  }
}

const toMeilisearchDocument = (
  row: SearchDocumentRow
): MeilisearchDocument => ({
  id: row.id,
  entityId: row.entityId,
  text: row.searchText ?? '',
  entityType: toMeilisearchType(row.entityType),
  actorId: row.actorId,
  visibility: row.visibility,
  entityCreatedAt: row.entityCreatedAt
    ? getCompatibleTime(row.entityCreatedAt)
    : null
})

const reindexMeilisearch = async ({
  clear,
  batchSize,
  dryRun
}: Pick<CliArgs, 'clear' | 'batchSize' | 'dryRun'>) => {
  const config = getConfig().search
  if (config.backend !== 'meilisearch') {
    throw new Error(
      'Meilisearch reindex requires ACTIVITIES_SEARCH_BACKEND=meilisearch and Meilisearch connection settings.'
    )
  }

  const knex = getKnex()
  const types: SearchDocumentRow['entityType'][] = [
    'account',
    'status',
    'hashtag'
  ]

  for (const entityType of types) {
    const meilisearchType = toMeilisearchType(entityType)
    const countRow = await knex('search_documents')
      .where('entityType', entityType)
      .where('searchable', true)
      .count<{ count: string | number }>('* as count')
      .first()
    const total = parseInt(String(countRow?.count ?? '0'), 10)

    if (dryRun) {
      console.log(`[meilisearch] ${meilisearchType}: ${total} documents`)
      continue
    }

    if (clear) {
      console.log(`[meilisearch] clearing ${meilisearchType}`)
      await deleteMeilisearchDocuments({ config, type: meilisearchType })
    }

    await configureMeilisearchIndex({ config, type: meilisearchType })

    let lastId: string | null = null
    let indexed = 0
    for (;;) {
      const query = knex<SearchDocumentRow>('search_documents')
        .where('entityType', entityType)
        .where('searchable', true)
        .orderBy('id', 'asc')
        .limit(batchSize)

      if (lastId) {
        query.where('id', '>', lastId)
      }

      const rows = await query

      if (rows.length === 0) break

      await writeMeilisearchDocuments({
        config,
        type: meilisearchType,
        documents: rows.map(toMeilisearchDocument)
      })
      lastId = rows[rows.length - 1].id
      indexed += rows.length
      console.log(
        `[meilisearch] ${meilisearchType}: indexed ${Math.min(
          indexed,
          total
        )}/${total}`
      )
    }
  }
}

const shouldRebuildMeilisearch = (backend: Backend) =>
  backend === 'meilisearch' || backend === 'all'

async function rebuildSearchIndex(args = process.argv.slice(2)) {
  if (isHelpRequest(args)) {
    console.log(USAGE)
    return 0
  }

  let input: CliArgs
  try {
    input = parseArgs(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    console.error(USAGE)
    return 1
  }

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  try {
    // The SQL search index is canonical and feeds Meilisearch, so every
    // backend mode refreshes it before optional backend export.
    const verb = input.dryRun ? 'would index' : 'indexed'
    const result = await database.rebuildSearchIndex({
      clear: input.clear,
      batchSize: input.batchSize,
      dryRun: input.dryRun
    })
    console.log(
      `[database] ${verb} ${result.accounts} accounts, ${result.statuses} statuses, ${result.hashtags} hashtags`
    )

    if (shouldRebuildMeilisearch(input.backend)) {
      await reindexMeilisearch(input)
    }

    return 0
  } finally {
    await database.destroy()
  }
}

if (require.main === module) {
  rebuildSearchIndex()
    .then((code) => {
      process.exit(code)
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error(message)
      process.exit(1)
    })
}
