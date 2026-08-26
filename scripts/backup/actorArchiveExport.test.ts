/**
 * `exportActorArchive` end to end, against a real SQLite database, for the one
 * property no unit test of `registerAttachmentUrl` can reach: that
 * `--remote-fetch-budget` is ONE budget spent across the whole run.
 *
 * It lives in its own file because reaching `exportActorArchive` at all means
 * mocking `@/lib/database`, `@/lib/config` and half of `./productionArchive` at
 * module scope. `actorArchive.test.ts` beside it never goes through those — it
 * calls the exported pieces directly, handing each one a real test database and
 * a hand-built `HostRuleConfig` — and blanket mocks here would be mocks it
 * neither wants nor can see around.
 *
 * Three source-text guards used to stand in for this and each one was defeated
 * in review by a different spelling of the same bug — recompute the deadline
 * per attachment and every attachment finds a full budget ahead of it, so the
 * feature does nothing while every result still looks right. A regex can say
 * where an expression is WRITTEN; only running the thing can say how often it
 * is EVALUATED. The remaining source guard in `actorArchive.test.ts` covers a
 * genuinely different property (the deadline never becomes an abort signal),
 * which only misbehaves once real time elapses and so cannot be tested here
 * either.
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { getTestSQLDatabase } from '@/lib/database/testUtils'
import { Database } from '@/lib/database/types'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const SKIPPED_WARNING_PREFIX =
  'Remote attachment fetch budget exhausted, kept as absolute URL: '
const REMOTE_HOST = 'remote-archive-host.llun.test'
const DOMAIN = 'actor-archive-export-test.llun.test'
const USERNAME = 'exportowner'

// Everything the hoisted `vi.mock` factories below need to reach: they are
// lifted above every import in this file, so a plain closure variable would
// still be in its temporal dead zone when they run.
const holder = vi.hoisted(() => ({
  database: null as unknown as Database,
  nowMs: 1_700_000_000_000,
  /** Wall-clock cost charged to the budget by each remote download. */
  msPerDownload: 600,
  stagingManifest: null as Record<string, unknown> | null
}))

vi.mock('@/lib/database', () => ({
  getDatabase: () => holder.database
}))

vi.mock('@/lib/config', () => ({
  getConfig: () => ({
    host: DOMAIN,
    trustedHosts: [],
    mediaStorage: undefined
  })
}))

vi.mock('@/lib/services/fitness-files', () => ({
  getEffectiveFitnessStorageConfig: () => null
}))

vi.mock('@/lib/services/medias/uploadSizeLimit', () => ({
  getMaxMediaUploadSize: async () => 1024 * 1024
}))

vi.mock('../fitness/describeConnection', () => ({
  printDatabaseBanner: () => undefined
}))

// Partial: the argument parser this script is built on has to stay real, or
// the flags under test are not the flags being exercised.
vi.mock('./productionArchive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./productionArchive')>()
  return {
    ...actual,
    loadEnvFile: async () => undefined,
    archiveStorage: async () => [],
    // The staging directory is removed in `exportActorArchive`'s `finally`, so
    // the manifest is read here — the last thing to touch it — rather than
    // from the tarball that is never written.
    createTarArchive: async (stagingDir: string) => {
      holder.stagingManifest = JSON.parse(
        await fs.readFile(path.join(stagingDir, 'manifest.json'), 'utf-8')
      )
    }
  }
})

// Every download succeeds instantly in real time and costs `msPerDownload` on
// the clock the budget reads. That is what makes "the budget ran out partway"
// deterministic instead of a race.
vi.mock('@/lib/utils/safeImageDownload', () => ({
  safeImageFetch: vi.fn(async () => {
    holder.nowMs += holder.msPerDownload
    return new Response('remote-bytes', { status: 200 })
  })
}))

const { safeImageFetch } = await vi.importMock<
  typeof import('@/lib/utils/safeImageDownload')
>('@/lib/utils/safeImageDownload')

const { exportActorArchive } = await import('./actorArchive')

/**
 * Read through a function on purpose. `runExport` clears the field before each
 * run, which narrows it to `null` for the rest of that block — and the mock
 * that fills it back in runs somewhere the compiler cannot follow, so a direct
 * read afterwards types as `never`.
 */
const readStagedManifest = () => holder.stagingManifest

/**
 * Seeds one status per remote attachment and runs a whole export.
 *
 * `--skip-storage` keeps this instance's own storage out of it; it does NOT
 * suppress `--fetch-remote-attachments`, which is the whole point of the run.
 */
const runExport = async ({
  attachmentCount,
  budgetSeconds
}: {
  attachmentCount: number
  budgetSeconds: number
}) => {
  const database = getTestSQLDatabase()
  holder.database = database
  holder.stagingManifest = null
  holder.nowMs = 1_700_000_000_000
  vi.mocked(safeImageFetch).mockClear()

  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => holder.nowMs)
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'actor-archive-export-test-')
  )

  try {
    await database.migrate()
    await database.createAccount({
      domain: DOMAIN,
      email: `${USERNAME}@example.test`,
      username: USERNAME,
      privateKey: 'test-private-key',
      publicKey: 'test-public-key',
      passwordHash: 'unused'
    })
    const actor = await database.getActorFromUsername({
      username: USERNAME,
      domain: DOMAIN
    })
    if (!actor) throw new Error('Failed to seed actor for the export test')

    for (let index = 0; index < attachmentCount; index += 1) {
      const statusId = `${actor.id}/statuses/remote-${index}`
      await database.createNote({
        id: statusId,
        actorId: actor.id,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        url: `https://${DOMAIN}/statuses/remote-${index}`,
        text: `status ${index}`,
        createdAt: holder.nowMs + index
      })
      // A DIFFERENT URL per status: `registerAttachmentUrl` memoizes on the
      // URL, so repeating one would silently collapse the run to a single
      // download and prove nothing about the budget.
      await database.createAttachment({
        actorId: actor.id,
        statusId,
        mediaType: 'image/jpeg',
        url: `https://${REMOTE_HOST}/files/photo-${index}.jpg`,
        name: `photo ${index}`
      })
    }

    const exitCode = await exportActorArchive([
      '--username',
      USERNAME,
      '--domain',
      DOMAIN,
      '--output-dir',
      outputDir,
      '--skip-storage',
      '--fetch-remote-attachments',
      '--remote-fetch-budget',
      String(budgetSeconds)
    ])

    const warnings = (readStagedManifest()?.warnings ?? []) as string[]
    return {
      exitCode,
      downloadedUrls: vi
        .mocked(safeImageFetch)
        .mock.calls.map(([url]) => url as string),
      // Split rather than filtered on a shared word: the per-attachment lines
      // and the one summary line are the two things an operator has to be able
      // to tell apart, so a test that lumped them together would not notice
      // them merging.
      budgetSkippedUrls: warnings
        .filter((warning) => warning.startsWith(SKIPPED_WARNING_PREFIX))
        .map((warning) => warning.slice(SKIPPED_WARNING_PREFIX.length)),
      budgetSummaries: warnings.filter((warning) =>
        warning.startsWith('Remote attachment fetch budget of ')
      )
    }
  } finally {
    // `exportActorArchive` destroys the database in its own `finally`, and a
    // second destroy is a no-op — but its `try` starts after the actor is
    // resolved, so a failure in the seeding above would otherwise leak the
    // connection pool. Cheaper to be unconditional than to reason about which
    // path threw.
    await database.destroy()
    nowSpy.mockRestore()
    logSpy.mockRestore()
    await fs.rm(outputDir, { force: true, recursive: true })
  }
}

describe('exportActorArchive remote fetch budget', () => {
  const remoteUrl = (index: number) =>
    `https://${REMOTE_HOST}/files/photo-${index}.jpg`

  // THE test. Five attachments, a 1s budget, and 600ms charged per download:
  // stamped once, the first download ends at 600ms and the second at 1200ms,
  // so the third finds the budget spent and the rest are skipped. Recompute
  // the deadline anywhere per attachment — inline, through a spread, or via a
  // helper defined above the loop and called inside it, the three spellings
  // that defeated the source-text guards — and every attachment finds a full
  // second ahead of it, so all five download and this fails on the count.
  it('spends one budget across the whole export, not one per attachment', async () => {
    const { exitCode, downloadedUrls, budgetSkippedUrls } = await runExport({
      attachmentCount: 5,
      budgetSeconds: 1
    })

    expect(exitCode).toBe(0)
    expect(downloadedUrls).toHaveLength(2)
    expect(budgetSkippedUrls).toHaveLength(3)

    // Every attachment is accounted for exactly once, and no URL is both. The
    // export walks statuses newest first, so WHICH two were downloaded is an
    // ordering detail this does not pin — that each one is either fetched or
    // kept, never dropped and never both, is the property.
    expect([...downloadedUrls, ...budgetSkippedUrls].sort()).toEqual(
      [0, 1, 2, 3, 4].map(remoteUrl).sort()
    )
  })

  // The tally and the summary line are the two steps between
  // `registerAttachmentUrl`'s per-call answer and what an operator reads.
  // Asserted on the count rather than on the line merely existing: an
  // accumulator that overwrites instead of adding, or one incremented for
  // every remote attachment rather than only the skipped ones, still produces
  // a well-formed sentence.
  it('reports the number the budget skipped as one distinct summary line', async () => {
    const { downloadedUrls, budgetSkippedUrls, budgetSummaries } =
      await runExport({ attachmentCount: 4, budgetSeconds: 1 })

    expect(downloadedUrls).toHaveLength(2)
    expect(budgetSkippedUrls).toHaveLength(2)
    expect(budgetSummaries).toEqual([
      'Remote attachment fetch budget of 1s was exhausted; ' +
        '2 remote attachments kept as absolute URLs. ' +
        'Re-run with a larger --remote-fetch-budget to fetch them.'
    ])
  })

  // A budget nothing reaches must leave no trace at all: a line that is always
  // present is a line operators stop reading.
  it('says nothing about the budget when the run never exhausts it', async () => {
    const { exitCode, downloadedUrls, budgetSkippedUrls, budgetSummaries } =
      await runExport({ attachmentCount: 3, budgetSeconds: 3600 })

    expect(exitCode).toBe(0)
    expect(downloadedUrls).toHaveLength(3)
    expect(budgetSkippedUrls).toEqual([])
    expect(budgetSummaries).toEqual([])
  })
})
