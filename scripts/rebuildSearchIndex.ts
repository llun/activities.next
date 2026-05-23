#!/usr/bin/env -S node -r @swc-node/register
import { loadEnvConfig } from '@next/env'

import { getDatabase } from '@/lib/database'

const DEFAULT_BATCH_SIZE = 500

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const parseBatchSize = () => {
  const value = Number(process.env.SEARCH_REINDEX_BATCH_SIZE)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BATCH_SIZE
}

async function reindexEntity(
  name: string,
  reindex: (params: {
    afterId?: string | null
    limit: number
  }) => Promise<{ indexed: number; nextCursor: string | null }>
) {
  const limit = parseBatchSize()
  let afterId: string | null = null
  let total = 0

  do {
    const result = await reindex({ afterId, limit })
    total += result.indexed
    afterId = result.nextCursor
    console.log(`${name}: indexed ${total}`)
  } while (afterId)
}

async function rebuildSearchIndex() {
  const database = getDatabase()
  if (!database) {
    console.error('Database is not available')
    return 1
  }

  try {
    await reindexEntity('accounts', (params) =>
      database.reindexSearchAccounts(params)
    )
    await reindexEntity('hashtags', (params) =>
      database.reindexSearchHashtags(params)
    )
    await reindexEntity('statuses', (params) =>
      database.reindexSearchStatuses(params)
    )
    console.log('Search index rebuild complete')
    return 0
  } finally {
    await database.destroy()
  }
}

rebuildSearchIndex()
  .then((code) => process.exit(code))
  .catch((error) => {
    const nodeError = error as Error
    console.error(nodeError.message)
    process.exit(1)
  })
