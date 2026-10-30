import { readFileSync } from 'node:fs'

import { classifyRun } from '../scripts/classify-ci-rerun.mjs'

type Step = { name: string; conclusion: string | null }

type Job = {
  name: string
  status: string
  conclusion: string | null
  runner_name: string | null
  steps: Step[]
}

const job = (overrides: Partial<Job> & Pick<Job, 'name'>) =>
  ({
    status: 'completed',
    conclusion: 'failure',
    runner_name: 'GitHub Actions 7',
    steps: [],
    ...overrides
  }) satisfies Job

const completedCodeFailure = (name: string, step: string) =>
  job({
    name,
    steps: [
      { name: 'Set up job', conclusion: 'success' },
      { name: step, conclusion: 'failure' }
    ]
  })

describe('ci re-run classification', () => {
  it('re-runs the #2688 shape: an abandoned job next to failed aggregates', () => {
    const result = classifyRun([
      job({
        name: 'PostgreSQL Tests (shard 1/2)',
        status: 'queued',
        conclusion: null,
        runner_name: null,
        steps: []
      }),
      job({ name: 'All Tests', conclusion: 'failure' }),
      job({ name: 'CI Success', conclusion: 'failure' })
    ])

    expect(result.rerun).toBe(true)
  })

  it('re-runs a Set up job-only failure', () => {
    const result = classifyRun([
      job({
        name: 'Build',
        steps: [{ name: 'Set up job', conclusion: 'failure' }]
      })
    ])

    expect(result.rerun).toBe(true)
  })

  it('keeps a failed repository step and names the step', () => {
    const result = classifyRun([
      job({
        name: 'Test Shard 1 of 4',
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'Run test shard', conclusion: 'failure' }
        ]
      })
    ])

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('Run test shard')
  })

  it('keeps a run with both an abandoned job and a code failure', () => {
    const result = classifyRun([
      job({
        name: 'PostgreSQL Tests (shard 1/2)',
        status: 'queued',
        conclusion: null,
        runner_name: null,
        steps: []
      }),
      completedCodeFailure('Lint and Prettier', 'Run lint')
    ])

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('Lint and Prettier')
  })

  it('keeps a cancelled job', () => {
    const result = classifyRun([
      job({ name: 'Build', conclusion: 'cancelled' })
    ])

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('Build was cancelled')
  })

  it('keeps a completed failure with no failed step (a timeout-minutes kill)', () => {
    const result = classifyRun([
      job({
        name: 'Test Shard 2 of 4',
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'Run test shard', conclusion: null }
        ]
      })
    ])

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('an unknown step')
  })

  it('re-runs an abandoned job (queued, no runner, no steps)', () => {
    const result = classifyRun([
      job({
        name: 'Docker Images Smoke Test (minimal)',
        status: 'queued',
        conclusion: null,
        runner_name: null,
        steps: []
      })
    ])

    expect(result.rerun).toBe(true)
  })

  it.each([
    { description: 'Install dependencies', jobName: 'Build' },
    { description: 'Run lint', jobName: 'Lint and Prettier' },
    { description: 'Build', jobName: 'Build' },
    { description: 'Run test shard', jobName: 'Test Shard 1 of 4' },
    {
      description: 'Build minimal Docker image',
      jobName: 'Docker Images Smoke Test (minimal)'
    }
  ])('keeps a failed $description step', ({ description, jobName }) => {
    const result = classifyRun([completedCodeFailure(jobName, description)])

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain(description)
  })

  it('keeps the runner SIGHUP (exit 129): a failure in the test step', () => {
    const result = classifyRun([
      completedCodeFailure(
        'PostgreSQL Tests (shard 2/2)',
        'Run PostgreSQL database tests (shard 2/2)'
      )
    ])

    expect(result.rerun).toBe(false)
  })

  it('re-runs only on attempt 1: the workflow job stops a second attempt', () => {
    const workflow = readFileSync('.github/workflows/ci-rerun.yml', 'utf8')

    expect(workflow).toContain('github.event.workflow_run.run_attempt == 1')
  })

  it('re-runs only the failed jobs of a failed CI run', () => {
    const workflow = readFileSync('.github/workflows/ci-rerun.yml', 'utf8')

    expect(workflow).toContain('run_attempt == 1')
    expect(workflow).toContain('--failed')
    expect(workflow).toContain('workflow_run')
    expect(workflow).not.toContain('ref:')
    expect(workflow).not.toContain('github.event.workflow_run.head_sha')
  })
})
