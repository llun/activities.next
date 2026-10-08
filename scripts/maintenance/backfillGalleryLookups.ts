#!/usr/bin/env -S node scripts/run.cjs
/**
 * Backfills the gallery lookups (place names and country codes, GBIF taxon and
 * IUCN status) for media that was uploaded before they existed, or whose lookup
 * never finished.
 *
 * WHY A SCRIPT. Nominatim forbids bulk bursts, so this is not a queue fan-out:
 * it walks the media in id order and calls the two job handlers directly, one
 * media at a time, through the same in-process rate limiters the jobs use. A
 * photo of a threatened species keeps its place hidden from other people until
 * its subject lookup has run, so run this after upgrading to bring existing
 * species photos out from behind that default.
 *
 * It selects:
 *   - media with coordinates and no place lookup status yet;
 *   - species-like subjects whose subject lookup is not final (never
 *     attempted, pending, failed or disabled).
 * A `resolved` or `no-match` result is final and is never redone here.
 *
 * Safe to repeat. Each job re-checks the Admin > Network switches itself, so
 * with a switch off it records `disabled` and sends nothing.
 *
 * Usage:
 *   NODE_ENV=production scripts/maintenance/backfillGalleryLookups.ts \
 *     [--dry-run] [--apply] [--actor <actorId>] [--limit <n>] \
 *     [--only subjects|places] [--prune-cache]
 *
 * Options:
 *   --dry-run      Report what would be looked up and change nothing (default)
 *   --apply        Run the lookups and write the results
 *   --actor <id>   Only this actor's media
 *   --limit <n>    Stop after n media
 *   --only <kind>  Only `subjects` or only `places`
 *   --prune-cache  Also delete expired rows from gallery_lookup_cache
 */
import { loadEnvConfig } from '@next/env'
import { Knex } from 'knex'

import { getDatabase, getKnex } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { resolveMediaPlaceJob } from '@/lib/jobs/resolveMediaPlaceJob'
import { resolveMediaSubjectJob } from '@/lib/jobs/resolveMediaSubjectJob'
import { isSpeciesLike } from '@/lib/services/gallery/publicMediaDetails'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const BATCH_SIZE = 100
const PRUNE_BATCH_SIZE = 500
// A subject lookup in one of these states is not final.
const NON_FINAL_SUBJECT_STATUSES = ['pending', 'failed', 'disabled']

export interface BackfillOptions {
  apply: boolean
  actorId?: string
  limit?: number
  only?: 'subjects' | 'places'
  pruneCache: boolean
}

export const parseArgs = (args: string[]): BackfillOptions => {
  const options: BackfillOptions = { apply: false, pruneCache: false }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run') {
      options.apply = false
    } else if (arg === '--apply') {
      options.apply = true
    } else if (arg === '--prune-cache') {
      options.pruneCache = true
    } else if (arg === '--actor') {
      const value = args[++i]
      if (!value) throw new Error('--actor needs an actor id')
      options.actorId = value
    } else if (arg === '--limit') {
      const parsed = Number.parseInt(args[++i] ?? '', 10)
      if (Number.isNaN(parsed) || parsed < 1) {
        throw new Error('--limit needs a positive number')
      }
      options.limit = parsed
    } else if (arg === '--only') {
      const value = args[++i]
      if (value !== 'subjects' && value !== 'places') {
        throw new Error('--only must be "subjects" or "places"')
      }
      options.only = value
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

interface CandidateRow {
  id: number | string
  placeLatitude: number | null
  placeLongitude: number | null
  placeLookupStatus: string | null
  subjectName: string | null
  subjectScientificName: string | null
  subjectCategory: string | null
  subjectTaxonKey: string | null
  subjectLookupStatus: string | null
}

const CANDIDATE_COLUMNS = [
  'id',
  'placeLatitude',
  'placeLongitude',
  'placeLookupStatus',
  'subjectName',
  'subjectScientificName',
  'subjectCategory',
  'subjectTaxonKey',
  'subjectLookupStatus'
]

export const needsPlaceLookup = (row: CandidateRow): boolean =>
  row.placeLatitude !== null &&
  row.placeLongitude !== null &&
  row.placeLookupStatus === null

export const needsSubjectLookup = (row: CandidateRow): boolean =>
  (row.subjectLookupStatus === null ||
    NON_FINAL_SUBJECT_STATUSES.includes(row.subjectLookupStatus)) &&
  isSpeciesLike({
    subjectName: row.subjectName,
    subjectScientificName: row.subjectScientificName,
    subjectTaxonKey: row.subjectTaxonKey,
    subjectCategory: row.subjectCategory as never
  })

// One keyset page of media that may need a lookup, oldest first. The subject
// test is finished in JS (needsSubjectLookup) because "species-like" is a rule
// of the app, not of the database.
export const selectCandidates = async ({
  knex,
  options,
  afterId
}: {
  knex: Knex
  options: BackfillOptions
  afterId: number
}): Promise<CandidateRow[]> => {
  const query = knex('medias')
    .select(CANDIDATE_COLUMNS)
    .where('id', '>', afterId)
    .orderBy('id', 'asc')
    .limit(BATCH_SIZE)

  if (options.actorId) query.where('actorId', options.actorId)

  query.where((builder) => {
    if (options.only !== 'subjects') {
      builder.orWhere((places) =>
        places
          .whereNotNull('placeLatitude')
          .whereNotNull('placeLongitude')
          .whereNull('placeLookupStatus')
      )
    }
    if (options.only !== 'places') {
      builder.orWhere((subjects) =>
        subjects
          .where((named) =>
            named
              .whereNotNull('subjectName')
              .orWhereNotNull('subjectScientificName')
              .orWhereNotNull('subjectTaxonKey')
          )
          .where((status) =>
            status
              .whereNull('subjectLookupStatus')
              .orWhereIn('subjectLookupStatus', NON_FINAL_SUBJECT_STATUSES)
          )
      )
    }
  })

  return query as unknown as Promise<CandidateRow[]>
}

export interface BackfillSummary {
  mediaSeen: number
  placeLookups: number
  subjectLookups: number
  prunedCacheRows: number
}

export const runBackfill = async ({
  database,
  knex,
  options,
  log = console.log
}: {
  database: Database
  knex: Knex
  options: BackfillOptions
  log?: (message: string) => void
}): Promise<BackfillSummary> => {
  const summary: BackfillSummary = {
    mediaSeen: 0,
    placeLookups: 0,
    subjectLookups: 0,
    prunedCacheRows: 0
  }
  log(
    `Starting gallery lookup backfill (${options.apply ? 'apply' : 'dry run'}${
      options.only ? `, only ${options.only}` : ''
    }${options.actorId ? `, actor ${options.actorId}` : ''})...`
  )

  let afterId = 0
  let done = false
  while (!done) {
    const rows = await selectCandidates({ knex, options, afterId })
    if (rows.length === 0) break

    for (const row of rows) {
      afterId = Number(row.id)
      const wantsPlace = options.only !== 'subjects' && needsPlaceLookup(row)
      const wantsSubject = options.only !== 'places' && needsSubjectLookup(row)
      if (!wantsPlace && !wantsSubject) continue

      if (options.limit !== undefined && summary.mediaSeen >= options.limit) {
        done = true
        break
      }
      summary.mediaSeen++
      const mediaId = String(row.id)

      // Sequential on purpose: the limiters pace the requests, and a bulk
      // burst is exactly what Nominatim's policy forbids.
      if (wantsSubject) {
        summary.subjectLookups++
        log(`[${mediaId}] subject lookup`)
        if (options.apply) {
          await resolveMediaSubjectJob(database, {
            id: `backfill-subject-${mediaId}`,
            name: 'ResolveMediaSubjectJob',
            data: { mediaId }
          })
        }
      }
      if (wantsPlace) {
        summary.placeLookups++
        log(`[${mediaId}] place lookup`)
        if (options.apply) {
          await resolveMediaPlaceJob(database, {
            id: `backfill-place-${mediaId}`,
            name: 'ResolveMediaPlaceJob',
            data: { mediaId }
          })
        }
      }
    }
  }

  if (options.pruneCache) {
    if (options.apply) {
      while (true) {
        const removed = await database.pruneGalleryLookups({
          before: Date.now(),
          limit: PRUNE_BATCH_SIZE
        })
        summary.prunedCacheRows += removed
        if (removed < PRUNE_BATCH_SIZE) break
      }
    } else {
      log('Would prune expired gallery_lookup_cache rows (--apply to do it)')
    }
  }

  log('Backfill summary:')
  log(`  Media with work:   ${summary.mediaSeen}`)
  log(`  Subject lookups:   ${summary.subjectLookups}`)
  log(`  Place lookups:     ${summary.placeLookups}`)
  if (options.pruneCache) {
    log(`  Cache rows pruned: ${summary.prunedCacheRows}`)
  }
  if (!options.apply) log('Dry run: nothing was changed. Use --apply to run.')
  return summary
}

if (process.argv[1]?.includes('backfillGalleryLookups')) {
  const main = async () => {
    const options = parseArgs(process.argv.slice(2))
    const database = getDatabase()
    const knex = getKnex()
    if (!database || !knex) {
      throw new Error('Database is not initialized')
    }
    try {
      await runBackfill({ database, knex, options })
    } finally {
      await database.destroy()
    }
  }

  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Backfill failed:', error)
      process.exit(1)
    })
}
