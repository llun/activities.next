#!/usr/bin/env -S node scripts/run.cjs
import { loadEnvConfig } from '@next/env'

import { readSearchEmbeddingsDimensions } from '@/lib/config/searchEmbeddings'
import { getKysely } from '@/lib/database'
import {
  SemanticSetupError,
  setupSemanticSearchTables
} from '@/lib/database/domains/search/semanticStore'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const USAGE = `Usage: yarn search:semantic:setup [--grant-to <role>] [--dimensions <n>] [--recreate]

Creates the pgvector extension and the semantic search tables on PostgreSQL.
Run it as a user that may create extensions (on Cloud SQL, \`postgres\` or another
cloudsqlsuperuser member) and pass --grant-to <app user> so the app can use them.
--dimensions defaults to ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS (768).
--recreate drops the table and its stored embeddings and builds it again; it is
required when the dimensions change, and then run yarn search:semantic:backfill.`

const parseArgs = (args: string[]) => {
  let grantTo: string | null = null
  let dimensions: number | null = null
  let recreate = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--recreate') recreate = true
    else if (arg === '--grant-to') grantTo = args[++index] ?? ''
    else if (arg === '--dimensions') dimensions = Number(args[++index])
    else if (arg === '--help' || arg === '-h') return null
    else throw new SemanticSetupError(`Unknown argument ${arg}\n\n${USAGE}`)
  }
  return { grantTo, dimensions, recreate }
}

async function setup() {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.log(USAGE)
    return 0
  }
  // --dimensions, else ACTIVITIES_SEARCH_EMBEDDINGS_DIMENSIONS read on its
  // own (the provider's key need not be set where this runs), else 768.
  let dimensions = args.dimensions
  if (dimensions === null) {
    const configured = readSearchEmbeddingsDimensions()
    if ('error' in configured) {
      console.error(configured.error)
      return 1
    }
    dimensions = configured.dimensions
  }
  const db = getKysely()
  try {
    const result = await setupSemanticSearchTables(db, {
      dimensions,
      recreate: args.recreate,
      grantTo: args.grantTo
    })
    console.log(`pgvector ${result.pgvectorVersion}`)
    console.log(
      result.recreated
        ? `Recreated the semantic search tables for ${dimensions} dimensions; run yarn search:semantic:backfill.`
        : result.created
          ? `Created the semantic search tables for ${dimensions} dimensions; run yarn search:semantic:backfill.`
          : `The semantic search tables already exist for ${dimensions} dimensions.`
    )
    if (result.grantedTo) {
      console.log(`Granted read and write on them to ${result.grantedTo}.`)
    }
    return 0
  } catch (error) {
    if (error instanceof SemanticSetupError) {
      console.error(error.message)
      return 1
    }
    throw error
  } finally {
    await db.destroy()
  }
}

setup()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error((error as Error).message)
    process.exit(1)
  })
