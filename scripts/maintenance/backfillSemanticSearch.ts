#!/usr/bin/env -S node scripts/run.cjs
import { loadEnvConfig } from '@next/env'

import { getKysely } from '@/lib/database'
import {
  getEmbeddableDocumentPage,
  getEmbeddingContentHash,
  getEmbeddingText,
  getSemanticAvailability,
  getSemanticStatus,
  getStoredEmbeddings,
  recordSemanticFailure,
  recordSemanticSuccess,
  saveBackfillCursor
} from '@/lib/database/domains/search/semanticStore'
import { getEmbeddingProvider } from '@/lib/services/search/semantic'
import { embedDocuments } from '@/lib/services/search/semantic/semanticSearch'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const USAGE = `Usage: yarn search:semantic:backfill [--dry-run] [--batch-size <n>] [--delay-ms <n>] [--restart]

Embeds the posts semantic search may hold (local public and unlisted posts, and
remote public posts of authors who opted in to search) that have no embedding
yet or whose text changed. Resumes from the last saved position unless
--restart. --dry-run only counts the posts and estimates the tokens it would send.
--batch-size (default 64) posts per provider request; --delay-ms (default 1000)
between requests.`

// About four characters per token for the languages most posts are in.
const estimateTokens = (text: string) => Math.ceil(text.length / 4)

const parseArgs = (args: string[]) => {
  const options = {
    dryRun: false,
    batchSize: 64,
    delayMs: 1000,
    restart: false
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--restart') options.restart = true
    else if (arg === '--batch-size') options.batchSize = Number(args[++index])
    else if (arg === '--delay-ms') options.delayMs = Number(args[++index])
    else if (arg === '--help' || arg === '-h') return null
    else throw new Error(`Unknown argument ${arg}\n\n${USAGE}`)
  }
  if (
    !Number.isInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 500
  ) {
    throw new Error('--batch-size must be an integer from 1 to 500')
  }
  if (!Number.isInteger(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be a non-negative integer')
  }
  return options
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function backfill() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    console.log(USAGE)
    return 0
  }
  const provider = getEmbeddingProvider()
  if (!provider) {
    console.error(
      'Semantic search is not configured: set ACTIVITIES_SEARCH_EMBEDDINGS_PROVIDER and its variables (docs/environment-variables.md).'
    )
    return 1
  }
  const db = getKysely()
  try {
    const availability = await getSemanticAvailability(db, provider.dimensions)
    if (!availability.available) {
      console.error(`Semantic search is off: ${availability.reason}`)
      return 1
    }
    let cursor = options.restart
      ? null
      : ((await getSemanticStatus(db))?.backfillCursor ?? null)
    if (cursor) console.log(`Resuming after ${cursor}`)
    let looked = 0
    let toSend = 0
    let tokens = 0
    for (;;) {
      const page = await getEmbeddableDocumentPage(db, {
        afterId: cursor,
        limit: options.batchSize
      })
      if (page.length === 0) break
      looked += page.length
      if (options.dryRun) {
        const stored = await getStoredEmbeddings(
          db,
          page.map((document) => document.id)
        )
        for (const document of page) {
          const text = getEmbeddingText(document.documentText)
          const current = stored.get(document.id)
          if (!text.trim()) continue
          if (
            current?.hasEmbedding &&
            current.contentHash === getEmbeddingContentHash(text) &&
            current.model === provider.model &&
            current.dimensions === provider.dimensions
          ) {
            continue
          }
          toSend += 1
          tokens += estimateTokens(text)
        }
      } else {
        try {
          const sent = await embedDocuments(db, provider, page)
          toSend += sent
          if (sent > 0) await recordSemanticSuccess(db)
        } catch (error) {
          await recordSemanticFailure(
            db,
            `backfill: ${error instanceof Error ? error.message : String(error)}`
          )
          throw error
        }
        await saveBackfillCursor(db, page[page.length - 1].id)
        if (toSend > 0 && options.delayMs > 0) await sleep(options.delayMs)
      }
      cursor = page[page.length - 1].id
      console.log(
        options.dryRun
          ? `Looked at ${looked}; ${toSend} to embed (~${tokens} tokens)`
          : `Looked at ${looked}; embedded ${toSend}`
      )
    }
    if (options.dryRun) {
      console.log(
        `Dry run: ${toSend} of ${looked} posts would be sent to ${provider.model}, about ${tokens} tokens.`
      )
    } else {
      await saveBackfillCursor(db, null)
      console.log(`Backfill complete: embedded ${toSend} of ${looked} posts.`)
    }
    return 0
  } finally {
    await db.destroy()
  }
}

backfill()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error((error as Error).message)
    process.exit(1)
  })
