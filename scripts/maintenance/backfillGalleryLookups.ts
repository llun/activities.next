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
 *   - media with coordinates whose place lookup is not final (never
 *     attempted, pending, failed or disabled), and a place `no-match`, which
 *     may be what a wrong or regional Nominatim answered;
 *   - species-like subjects whose subject lookup is not final (the same, and
 *     `no-match`, which no longer clears a place).
 * A `resolved` result is final and is never redone here.
 *
 * A provider outage does not fail the rest of the run. When a provider's
 * circuit is open (after a timeout, a 5xx or a 429) the script waits for it to
 * close before the next lookup, and a lookup that failed because the circuit
 * opened under it is asked again once it closes. Without that, one blip would
 * mark every remaining photo `failed` within seconds. Every lookup runs as a
 * retry, so a failure the lookup cache remembers (from the app server, say),
 * and a remembered cell with no name, is asked again rather than answered.
 *
 * A persistent outage is bounded: after 3 lookups in a row that failed both
 * times, the script gives up on that provider for the rest of the run, says
 * so, and goes on with the other provider. With the default 5 minute circuit
 * that is at most about half an hour of waiting per provider (longer only if
 * the provider asks for a longer Retry-After). Run it again once the provider
 * is back.
 *
 * Safe to repeat: a run picks up whatever an earlier run left failed, and
 * whatever was marked `disabled` while a switch was off. Each job re-checks the
 * Admin > Network switches itself, so with a switch off it records `disabled`
 * and sends nothing.
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
import { gbifProvider } from '@/lib/services/gallery/lookups/gbif'
import { nominatimProvider } from '@/lib/services/gallery/lookups/nominatim'
import { CircuitBreaker } from '@/lib/services/gallery/lookups/rateLimit'
import { isSpeciesLike } from '@/lib/services/gallery/publicMediaDetails'

const projectDir = process.cwd()
loadEnvConfig(projectDir, process.env.NODE_ENV === 'development')

const BATCH_SIZE = 100
// Lookups in a row that failed even after waiting out the circuit, before the
// run stops asking that provider.
export const MAX_CONSECUTIVE_OUTAGES = 3
const PRUNE_BATCH_SIZE = 500
// A lookup in one of these states (or with no status) is not final.
const NON_FINAL_STATUSES = ['pending', 'failed', 'disabled']
// A subject `no-match` no longer clears a place (an earlier release wrote it
// for names GBIF's first page of results missed), so it is asked again. A
// place `no-match` may be what a wrong or regional endpoint answered, so it
// is asked again too, past the remembered miss.
const SUBJECT_NON_FINAL_STATUSES = [...NON_FINAL_STATUSES, 'no-match']
const PLACE_NON_FINAL_STATUSES = [...NON_FINAL_STATUSES, 'no-match']

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

const isNonFinal = (status: string | null, nonFinal = NON_FINAL_STATUSES) =>
  status === null || nonFinal.includes(status)

export const needsPlaceLookup = (row: CandidateRow): boolean =>
  row.placeLatitude !== null &&
  row.placeLongitude !== null &&
  isNonFinal(row.placeLookupStatus, PLACE_NON_FINAL_STATUSES)

export const needsSubjectLookup = (row: CandidateRow): boolean =>
  isNonFinal(row.subjectLookupStatus, SUBJECT_NON_FINAL_STATUSES) &&
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
          .where((status) =>
            status
              .whereNull('placeLookupStatus')
              .orWhereIn('placeLookupStatus', PLACE_NON_FINAL_STATUSES)
          )
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
              .orWhereIn('subjectLookupStatus', SUBJECT_NON_FINAL_STATUSES)
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
  // Providers the run stopped asking after a persistent outage.
  gaveUp: string[]
}

export interface BackfillProviders {
  places: CircuitBreaker
  subjects: CircuitBreaker
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// Waits out an open circuit, so a lookup is not failed on the spot.
const waitForProvider = async (
  breaker: CircuitBreaker,
  name: string,
  sleep: (ms: number) => Promise<void>,
  log: (message: string) => void
) => {
  while (breaker.isOpen()) {
    const waitMs = Math.max(1000, breaker.remainingMs())
    log(
      `${name} is unavailable; waiting ${Math.ceil(waitMs / 1000)} s before going on`
    )
    await sleep(waitMs)
  }
}

export const runBackfill = async ({
  database,
  knex,
  options,
  log = console.log,
  providers = {
    places: nominatimProvider.breaker,
    subjects: gbifProvider.breaker
  },
  sleep = defaultSleep
}: {
  database: Database
  knex: Knex
  options: BackfillOptions
  log?: (message: string) => void
  providers?: BackfillProviders
  sleep?: (ms: number) => Promise<void>
}): Promise<BackfillSummary> => {
  // Per provider: lookups in a row that failed after the second attempt.
  const outages = new Map<string, number>()
  const hasGivenUp = (name: string) =>
    (outages.get(name) ?? 0) >= MAX_CONSECUTIVE_OUTAGES

  // One lookup, paced by its provider's circuit. When the circuit opened
  // during this lookup it failed because of it: wait, and ask once more.
  // A lookup still failing then counts towards giving up on the provider.
  const runLookup = async (
    breaker: CircuitBreaker,
    name: string,
    run: () => Promise<void>
  ) => {
    await waitForProvider(breaker, name, sleep, log)
    await run()
    if (!breaker.isOpen()) {
      outages.set(name, 0)
      return
    }
    await waitForProvider(breaker, name, sleep, log)
    await run()
    if (!breaker.isOpen()) {
      outages.set(name, 0)
      return
    }
    const count = (outages.get(name) ?? 0) + 1
    outages.set(name, count)
    if (count >= MAX_CONSECUTIVE_OUTAGES) {
      summary.gaveUp.push(name)
      log(
        `Gave up on ${name}: ${count} lookups in a row failed after waiting for it. Its remaining lookups are skipped; run the backfill again later.`
      )
    }
  }

  const summary: BackfillSummary = {
    mediaSeen: 0,
    placeLookups: 0,
    subjectLookups: 0,
    prunedCacheRows: 0,
    gaveUp: []
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
      // A provider given up on (see runLookup) is not asked again this run.
      const wantsPlace =
        options.only !== 'subjects' &&
        needsPlaceLookup(row) &&
        !hasGivenUp('Nominatim')
      const wantsSubject =
        options.only !== 'places' &&
        needsSubjectLookup(row) &&
        !hasGivenUp('GBIF')
      if (!wantsPlace && !wantsSubject) continue

      if (options.limit !== undefined && summary.mediaSeen >= options.limit) {
        done = true
        break
      }
      summary.mediaSeen++
      const mediaId = String(row.id)

      // Sequential on purpose: the limiters pace the requests, and a bulk
      // burst is exactly what Nominatim's policy forbids.
      // Every lookup is a retry: the cache's remembered failures are asked
      // again (its hits and misses are still used).
      if (wantsSubject) {
        summary.subjectLookups++
        log(`[${mediaId}] subject lookup`)
        if (options.apply) {
          await runLookup(providers.subjects, 'GBIF', () =>
            resolveMediaSubjectJob(database, {
              id: `backfill-subject-${mediaId}`,
              name: 'ResolveMediaSubjectJob',
              data: { mediaId, retry: true }
            })
          )
        }
      }
      if (wantsPlace) {
        summary.placeLookups++
        log(`[${mediaId}] place lookup`)
        if (options.apply) {
          await runLookup(providers.places, 'Nominatim', () =>
            resolveMediaPlaceJob(database, {
              id: `backfill-place-${mediaId}`,
              name: 'ResolveMediaPlaceJob',
              data: { mediaId, retry: true }
            })
          )
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
  if (summary.gaveUp.length > 0) {
    log(`  Gave up on:        ${summary.gaveUp.join(', ')} (run again later)`)
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
