import { readFileSync } from 'node:fs'

import {
  classifyRun,
  decide,
  formatOutput,
  newestRunId
} from '../scripts/classify-ci-rerun.mjs'

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
      job({
        name: 'All Tests',
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'Verify all test shards succeeded', conclusion: 'failure' }
        ]
      }),
      job({
        name: 'CI Success',
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'Verify all CI jobs succeeded', conclusion: 'failure' }
        ]
      })
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

  it('re-runs a runner-less completed failure with no steps', () => {
    const result = classifyRun([
      job({
        name: 'Docker Images Smoke Test (minimal)',
        status: 'completed',
        conclusion: 'failure',
        runner_name: null,
        steps: []
      })
    ])

    expect(result.rerun).toBe(true)
  })

  it('keeps a runner-less cancelled job', () => {
    const result = classifyRun([
      job({
        name: 'Docker Images Smoke Test (minimal)',
        status: 'completed',
        conclusion: 'cancelled',
        runner_name: null,
        steps: []
      })
    ])

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('was cancelled')
  })

  it('re-runs an aggregate that failed in Set up job alone', () => {
    const result = classifyRun([
      job({
        name: 'All Tests',
        steps: [{ name: 'Set up job', conclusion: 'failure' }]
      })
    ])

    expect(result.rerun).toBe(true)
  })

  it('re-runs an aggregate that never got a runner', () => {
    const result = classifyRun([
      job({
        name: 'CI Success',
        status: 'queued',
        conclusion: null,
        runner_name: null,
        steps: []
      })
    ])

    expect(result.rerun).toBe(true)
  })

  it('keeps an aggregate that failed only in its Verify step', () => {
    const result = classifyRun([
      job({
        name: 'All Tests',
        steps: [
          { name: 'Set up job', conclusion: 'success' },
          { name: 'Verify all test shards succeeded', conclusion: 'failure' }
        ]
      })
    ])

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('no failed job outside the aggregates')
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

  it('decide: does not re-run when a newer run exists', () => {
    const result = decide(
      [
        job({
          name: 'Build',
          steps: [{ name: 'Set up job', conclusion: 'failure' }]
        })
      ],
      111,
      222
    )

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('111')
    expect(result.reason).toContain('222')
  })

  it('decide: does not re-run an older run against newestRunId of several ids', () => {
    const result = decide(
      [
        job({
          name: 'Build',
          steps: [{ name: 'Set up job', conclusion: 'failure' }]
        })
      ],
      111,
      newestRunId([111, 222])
    )

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('222')
  })

  it('decide: a leading space in NEWEST_RUN_IDS leaves an ignorable empty token', () => {
    const ids = ' 111 222'.split(/\s+/)
    expect(ids[0]).toBe('')
    const newest = newestRunId(ids)
    expect(newest).toBe('222')

    const jobs = [
      job({
        name: 'Build',
        steps: [{ name: 'Set up job', conclusion: 'failure' }]
      })
    ]
    expect(decide(jobs, '222', newest).rerun).toBe(true)
    expect(decide(jobs, '111', newest).rerun).toBe(false)
  })

  it('decide: delegates to classifyRun when the ids match as number vs string', () => {
    const result = decide(
      [
        job({
          name: 'Build',
          steps: [{ name: 'Set up job', conclusion: 'failure' }]
        })
      ],
      123,
      '123'
    )

    expect(result.rerun).toBe(true)
    expect(result.reason).toContain(
      'every failed job never ran repository code'
    )
  })

  it('decide: fails closed when the newest run id is missing', () => {
    const result = decide(
      [
        job({
          name: 'Build',
          steps: [{ name: 'Set up job', conclusion: 'failure' }]
        })
      ],
      123,
      undefined
    )

    expect(result.rerun).toBe(false)
    expect(result.reason).toContain('123')
    expect(result.reason).toContain('missing')
  })

  it('newestRunId: picks the largest, including ids too big for Number', () => {
    expect(newestRunId(['9007199254740992', '9007199254740993', '42'])).toBe(
      '9007199254740993'
    )
    expect(newestRunId(['7', '123', '45'])).toBe('123')
  })

  it('newestRunId: ignores empty strings, null and non-digit values', () => {
    expect(newestRunId(['', 'null', 'abc', '12a', null, '9'])).toBe('9')
    expect(newestRunId(['', 'null', null])).toBeUndefined()
  })

  it('newestRunId: returns undefined when nothing qualifies', () => {
    expect(newestRunId([])).toBeUndefined()
    expect(newestRunId(undefined)).toBeUndefined()
  })

  it('formatOutput: a newline in the reason cannot inject output lines', () => {
    const output = formatOutput(
      classifyRun([completedCodeFailure('Evil\r\nrerun=true', 'Run lint')])
    )

    const lines = output.split('\n')
    expect(lines).toHaveLength(3) // two lines plus the trailing newline
    expect(lines.filter((line) => line.startsWith('rerun='))).toEqual([
      'rerun=false'
    ])
    expect(lines[1]).toContain('Evil  rerun=true')
  })

  it('workflow: no ${{ inside a run block, env carries branch and event, newest-run lookup present', () => {
    const workflow = readFileSync('.github/workflows/ci-rerun.yml', 'utf8')

    expect(workflow).toContain(
      'HEAD_BRANCH: ${{ github.event.workflow_run.head_branch }}'
    )
    expect(workflow).toContain('EVENT: ${{ github.event.workflow_run.event }}')
    expect(workflow).toContain('actions/workflows/ci.yml/runs')
    expect(workflow).toContain('push workflow_dispatch')
    expect(workflow).toContain('NEWEST_RUN_IDS')
    expect(workflow).not.toContain('NEWEST_RUN_ID=')

    const lines = workflow.split('\n')
    let inRunBlock = false
    let runIndent = 0
    for (const line of lines) {
      const indent = line.length - line.trimStart().length
      if (inRunBlock && line.trim() !== '' && indent <= runIndent)
        inRunBlock = false
      if (!inRunBlock) {
        if (/^\s*(-\s+)?run: [>|]/.test(line)) {
          inRunBlock = true
          runIndent = indent
        }
      } else if (line.trim() !== '') {
        expect(line).not.toContain('${{')
      }
    }
  })
})
