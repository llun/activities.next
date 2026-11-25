import { execFileSync } from 'node:child_process'

import { JOBS } from '@/lib/jobs'
import * as jobNames from '@/lib/jobs/names'

describe('JOBS registry', () => {
  it('registers all known job names as own property getters returning functions', () => {
    const names = Object.values(jobNames)
    expect(names.length).toBeGreaterThan(0)

    for (const name of names) {
      expect(Object.prototype.hasOwnProperty.call(JOBS, name)).toBe(true)
      expect(typeof JOBS[name]).toBe('function')
    }
  })

  it('avoids TDZ when createNoteJob is the initial entry point in a fresh process', () => {
    expect(() => {
      execFileSync(
        process.execPath,
        ['-r', 'tsx/cjs', '-e', 'require("./lib/jobs/createNoteJob.ts")'],
        {
          cwd: process.cwd(),
          encoding: 'utf-8',
          stdio: 'pipe'
        }
      )
    }).not.toThrow()
  })

  // Scripts run as CommonJS (`scripts/run.cjs`, tsx/cjs), and the job
  // registry, actor deletion, database layer and media service sit in their
  // graphs. A static `@atproto/*` or `multiformats` import there fails with
  // ERR_PACKAGE_PATH_NOT_EXPORTED, so the PDS modules they reach stay CJS-safe
  // and the Bluesky client loads `@atproto/*` on first use.
  it('loads the job registry, deletion, database, PDS storage helpers and scripts in CommonJS without ESM-only imports', () => {
    for (const entry of [
      './lib/jobs/deleteActorJob.ts',
      './lib/database/index.ts',
      './lib/jobs/index.ts',
      './lib/services/actors/actorDeletion.ts',
      './lib/services/pds/blobStorage.ts',
      './lib/services/pds/retention.ts',
      './lib/services/medias/index.ts',
      './scripts/maintenance/cleanupMediaStorage.ts',
      './scripts/backup/productionArchive.ts'
    ]) {
      try {
        execFileSync(
          process.execPath,
          ['-r', 'tsx/cjs', '-e', `require(${JSON.stringify(entry)})`],
          {
            cwd: process.cwd(),
            encoding: 'utf-8',
            stdio: 'pipe'
          }
        )
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr
        throw new Error(
          `require(${JSON.stringify(entry)}) failed in a fresh CommonJS process:\n${stderr ?? String(error)}`,
          { cause: error }
        )
      }
    }
  })

  // `import()` stays native under tsx/cjs, so a relative or `@/` specifier in a
  // lazy load fails when the Bluesky OAuth client is first built from a script.
  it('builds the Bluesky OAuth client in CommonJS', () => {
    const script = `
      const crypto = require('node:crypto')
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
      process.env.ACTIVITIES_BLUESKY_OAUTH_PRIVATE_KEYS = JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: 'test', alg: 'ES256' })
      process.env.ACTIVITIES_HOST = 'social.example'
      process.env.ACTIVITIES_SECRET_PHASE = 'x'.repeat(40)
      process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
      process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
      const { getBlueskyOAuthClient } = require('./lib/services/bluesky/client.ts')
      getBlueskyOAuthClient({}, 'social.example').then(
        (client) => { process.stdout.write(typeof client.authorize); process.exit(0) },
        (error) => { process.stderr.write(String(error && error.stack)); process.exit(1) }
      )
    `
    const output = execFileSync(
      process.execPath,
      ['-r', 'tsx/cjs', '-e', script],
      { cwd: process.cwd(), encoding: 'utf-8', stdio: 'pipe' }
    )
    expect(output).toBe('function')
  })

  // The queue worker script runs under tsx/cjs, where a native
  // `import('@/lib/jobs')` cannot resolve the `@/` alias, so it dispatches
  // through the statically imported registry in staticJobHandle.ts.
  it('dispatches jobs through the static job handle in CommonJS', () => {
    const script = `
      process.env.ACTIVITIES_HOST = 'social.example'
      process.env.ACTIVITIES_SECRET_PHASE = 'x'.repeat(40)
      process.env.ACTIVITIES_DATABASE_CLIENT = 'better-sqlite3'
      process.env.ACTIVITIES_DATABASE_SQLITE_FILENAME = ':memory:'
      const { logger } = require('./lib/utils/logger.ts')
      const errors = []
      logger.error = (...args) => { errors.push(args[args.length - 1]) }
      const { CREATE_NOTE_JOB_NAME } = require('./lib/jobs/names.ts')
      const { createStaticJobHandle, loadStaticJobRegistry } = require('./lib/services/queue/staticJobHandle.ts')
      ;(async () => {
        const registry = await loadStaticJobRegistry()
        await createStaticJobHandle('database')({ id: 'probe', name: 'no-such-job', data: {} })
        process.stdout.write(JSON.stringify({
          hasCreateNote: typeof registry[CREATE_NOTE_JOB_NAME] === 'function',
          errors
        }))
        process.exit(0)
      })().catch((error) => { process.stderr.write(String(error && error.stack)); process.exit(1) })
    `
    const output = execFileSync(
      process.execPath,
      ['-r', 'tsx/cjs', '-e', script],
      { cwd: process.cwd(), encoding: 'utf-8', stdio: 'pipe' }
    )
    expect(JSON.parse(output)).toEqual({
      hasCreateNote: true,
      errors: ['Unknown job name']
    })
  })

  // The app's queue modules keep loading the registry on first job.
  it('keeps the job registry out of the queue modules the app imports', () => {
    const script = `
      require('./lib/services/queue/index.ts')
      require('./lib/services/queue/databaseRunner.ts')
      process.stdout.write(String(Object.keys(require.cache).some((key) => key.endsWith('/lib/jobs/index.ts'))))
    `
    const output = execFileSync(
      process.execPath,
      ['-r', 'tsx/cjs', '-e', script],
      { cwd: process.cwd(), encoding: 'utf-8', stdio: 'pipe' }
    )
    expect(output).toBe('false')
  })
})
