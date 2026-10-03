import { readFileSync } from 'node:fs'

import {
  REQUIRED_WORKFLOWS,
  REQUIRED_WORKFLOW_FILES,
  selectSyncCommit
} from '../scripts/select-sync-commit.mjs'

type Run = {
  workflow: string
  head_sha: string
  run_attempt: number
  updated_at: string
  status: string
  conclusion: string | null
}

const run = (overrides: Partial<Run> & Pick<Run, 'workflow' | 'head_sha'>) =>
  ({
    run_attempt: 1,
    updated_at: '2026-10-03T01:00:00Z',
    status: 'completed',
    conclusion: 'success',
    ...overrides
  }) satisfies Run

const greenRuns = (sha: string) =>
  REQUIRED_WORKFLOWS.map((workflow) => run({ workflow, head_sha: sha }))

describe('daily activities.prod sync commit selection', () => {
  it('selects the newest commit when every required workflow succeeded', () => {
    const result = selectSyncCommit({
      commits: ['new', 'old'],
      runs: [...greenRuns('new'), ...greenRuns('old')]
    })

    expect(result.sha).toBe('new')
    expect(result.evaluated.map((entry) => entry.sha)).toEqual(['new'])
  })

  it.each([
    ['still running', { status: 'in_progress', conclusion: null }],
    ['failed', { conclusion: 'failure' }],
    ['cancelled', { conclusion: 'cancelled' }],
    ['skipped', { conclusion: 'skipped' }]
  ])(
    'falls back to an older green commit when the newest CI run is %s',
    (_label, overrides) => {
      const result = selectSyncCommit({
        commits: ['new', 'old'],
        runs: [
          run({ workflow: 'CI', head_sha: 'new', ...overrides }),
          run({ workflow: 'Package', head_sha: 'new' }),
          run({ workflow: 'CodeQL', head_sha: 'new' }),
          ...greenRuns('old')
        ]
      })

      expect(result.sha).toBe('old')
    }
  )

  it('falls back when a required workflow has no run on the newest commit', () => {
    const result = selectSyncCommit({
      commits: ['new', 'old'],
      runs: [
        run({ workflow: 'CI', head_sha: 'new' }),
        run({ workflow: 'Package', head_sha: 'new' }),
        ...greenRuns('old')
      ]
    })

    expect(result.sha).toBe('old')
    expect(result.evaluated[0]).toEqual({
      sha: 'new',
      states: {
        CI: 'completed/success (attempt 1)',
        Package: 'completed/success (attempt 1)',
        CodeQL: 'missing'
      }
    })
  })

  it('lets a successful re-run supersede a failed first attempt', () => {
    const result = selectSyncCommit({
      commits: ['new'],
      runs: [
        run({ workflow: 'CI', head_sha: 'new', conclusion: 'failure' }),
        run({ workflow: 'CI', head_sha: 'new', run_attempt: 2 }),
        run({ workflow: 'Package', head_sha: 'new' }),
        run({ workflow: 'CodeQL', head_sha: 'new' })
      ]
    })

    expect(result.sha).toBe('new')
  })

  it('lets a failed re-run supersede a successful first attempt', () => {
    const result = selectSyncCommit({
      commits: ['new'],
      runs: [
        run({ workflow: 'CI', head_sha: 'new' }),
        run({
          workflow: 'CI',
          head_sha: 'new',
          run_attempt: 2,
          conclusion: 'failure'
        }),
        run({ workflow: 'Package', head_sha: 'new' }),
        run({ workflow: 'CodeQL', head_sha: 'new' })
      ]
    })

    expect(result.sha).toBeNull()
  })

  it('uses the most recently updated run when attempts are equal', () => {
    const result = selectSyncCommit({
      commits: ['new'],
      runs: [
        run({
          workflow: 'CI',
          head_sha: 'new',
          updated_at: '2026-10-03T02:00:00Z',
          conclusion: 'failure'
        }),
        run({
          workflow: 'CI',
          head_sha: 'new',
          updated_at: '2026-10-03T01:00:00Z'
        }),
        run({ workflow: 'Package', head_sha: 'new' }),
        run({ workflow: 'CodeQL', head_sha: 'new' })
      ]
    })

    expect(result.sha).toBeNull()
  })

  it('ignores runs of workflows that do not gate the sync', () => {
    const result = selectSyncCommit({
      commits: ['new', 'old'],
      runs: [
        run({ workflow: 'Version Bump', head_sha: 'new' }),
        run({ workflow: 'CI', head_sha: 'new' }),
        run({ workflow: 'Package', head_sha: 'new' }),
        ...greenRuns('old')
      ]
    })

    expect(result.sha).toBe('old')
  })

  it('returns no commit, with every inspected commit, when none is green', () => {
    const result = selectSyncCommit({
      commits: ['new', 'old'],
      runs: [
        run({ workflow: 'CI', head_sha: 'new', conclusion: 'failure' }),
        run({
          workflow: 'CI',
          head_sha: 'old',
          status: 'queued',
          conclusion: null
        })
      ]
    })

    expect(result.sha).toBeNull()
    expect(result.evaluated).toEqual([
      {
        sha: 'new',
        states: {
          CI: 'completed/failure (attempt 1)',
          Package: 'missing',
          CodeQL: 'missing'
        }
      },
      {
        sha: 'old',
        states: {
          CI: 'queued/n/a (attempt 1)',
          Package: 'missing',
          CodeQL: 'missing'
        }
      }
    ])
  })
})

describe('daily activities.prod sync workflow', () => {
  const workflow = readFileSync(
    '.github/workflows/sync-main-to-prod-dispatch.yml',
    'utf8'
  )

  it('runs once a day at 01:17 UTC or by hand, never after each merge', () => {
    const triggers = workflow.slice(
      workflow.indexOf('\non:\n'),
      workflow.indexOf('\npermissions:\n')
    )

    expect(triggers).toBe(
      "\non:\n  schedule:\n    - cron: '17 1 * * *'\n  workflow_dispatch:\n"
    )
    expect(workflow).not.toMatch(/^\s*workflow_run:/m)
  })

  it.each(Object.entries(REQUIRED_WORKFLOW_FILES))(
    'gates on the %s workflow defined in %s',
    (name, file) => {
      const definition = readFileSync(`.github/workflows/${file}`, 'utf8')

      expect(definition).toMatch(new RegExp(`^name: '?${name}'?$`, 'm'))
    }
  )
})
