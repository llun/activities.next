#!/usr/bin/env -S node -r @swc-node/register
import { loadEnvConfig } from '@next/env'
import { z } from 'zod'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import {
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

const parseArgs = (args: string[]): CliArgs => {
  const parsed: Record<string, string | boolean> = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      throw new Error(USAGE)
    }
    if (arg === '--clear' || arg === '--dry-run') {
      parsed[arg.slice(2)] = true
      continue
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`)
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2)
    const value = inlineValue ?? args[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${rawKey}`)
    }
    if (inlineValue === undefined) {
      index += 1
    }
    parsed[rawKey] = value
  }

  return CliArgs.parse({
    backend: parsed.backend,
    clear: Boolean(parsed.clear),
    batchSize: parsed['batch-size'] ? Number(parsed['batch-size']) : undefined,
    dryRun: Boolean(parsed['dry-run'])
  })
}

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

    for (let offset = 0; ; offset += batchSize) {
      const rows = await knex<SearchDocumentRow>('search_documents')
        .where('entityType', entityType)
        .where('searchable', true)
        .orderBy('entityCreatedAt', 'asc')
        .orderBy('entityId', 'asc')
        .limit(batchSize)
        .offset(offset)

      if (rows.length === 0) break

      await writeMeilisearchDocuments({
        config,
        type: meilisearchType,
        documents: rows.map(toMeilisearchDocument)
      })
      console.log(
        `[meilisearch] ${meilisearchType}: indexed ${Math.min(
          offset + rows.length,
          total
        )}/${total}`
      )
    }
  }
}

const shouldRebuildDatabase = (backend: Backend) =>
  backend === 'database' || backend === 'meilisearch' || backend === 'all'

const shouldRebuildMeilisearch = (backend: Backend) =>
  backend === 'meilisearch' || backend === 'all'

async function rebuildSearchIndex(args = process.argv.slice(2)) {
  let input: CliArgs
  try {
    input = parseArgs(args)
  } catch (error) {
    const nodeError = error as Error
    console.error(nodeError.message)
    if (nodeError.message !== USAGE) {
      console.error(USAGE)
    }
    return 1
  }

  const database = getDatabase()
  if (!database) {
    console.error('Error: Database is not available')
    return 1
  }

  if (shouldRebuildDatabase(input.backend)) {
    const verb = input.dryRun ? 'would index' : 'indexed'
    const result = await database.rebuildSearchIndex({
      clear: input.clear,
      batchSize: input.batchSize,
      dryRun: input.dryRun
    })
    console.log(
      `[database] ${verb} ${result.accounts} accounts, ${result.statuses} statuses, ${result.hashtags} hashtags`
    )
  }

  if (shouldRebuildMeilisearch(input.backend)) {
    await reindexMeilisearch(input)
  }

  await database.destroy()
  return 0
}

rebuildSearchIndex()
  .then((code) => {
    process.exit(code)
  })
  .catch((error) => {
    const nodeError = error as Error
    console.error(nodeError.message)
    process.exit(1)
  })
