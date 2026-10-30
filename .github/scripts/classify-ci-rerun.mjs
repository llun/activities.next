// Decides whether a failed CI run may be re-run automatically. Only a run in
// which every failed job provably executed no repository code qualifies: a
// job that never got a runner (queued/abandoned), or whose only failed steps
// are the runner's own setup steps. Any failed step that runs code from the
// checkout (install, lint, build, test, docker) blocks the re-run, whatever
// its log says, so a code failure is never retried into green.
import console from 'node:console'
import process from 'node:process'

export const AGGREGATE_JOBS = new Set(['All Tests', 'CI Success'])
export const INFRASTRUCTURE_STEPS = new Set([
  'Set up job',
  'Initialize containers',
  'Checkout',
  'Use Node.js 24'
])

// The aggregate jobs only mirror their shards' outcomes through their own
// `Verify …` steps, so an aggregate that failed elsewhere (or never got a
// runner) is classified like any other job.
const isAggregateShim = (job) => {
  if (!AGGREGATE_JOBS.has(job.name)) return false
  const failedSteps = (job.steps ?? [])
    .filter((step) => step.conclusion === 'failure')
    .map((step) => step.name)
  return (
    failedSteps.length > 0 &&
    failedSteps.every((name) => name.startsWith('Verify '))
  )
}

export const classifyRun = (jobs) => {
  const failed = jobs.filter(
    (job) =>
      !isAggregateShim(job) &&
      job.conclusion !== 'success' &&
      job.conclusion !== 'skipped'
  )
  if (failed.length === 0)
    return { rerun: false, reason: 'no failed job outside the aggregates' }
  for (const job of failed) {
    const steps = job.steps ?? []
    if (
      !job.runner_name &&
      steps.length === 0 &&
      job.conclusion !== 'cancelled'
    )
      continue // never got a runner
    if (job.conclusion === 'cancelled')
      return { rerun: false, reason: `${job.name} was cancelled` }
    const failedSteps = steps
      .filter((step) => step.conclusion === 'failure')
      .map((step) => step.name)
    if (
      failedSteps.length > 0 &&
      failedSteps.every((name) => INFRASTRUCTURE_STEPS.has(name))
    )
      continue
    return {
      rerun: false,
      reason: `${job.name} failed in ${failedSteps.length ? failedSteps.join(', ') : 'an unknown step'}`
    }
  }
  return {
    rerun: true,
    reason: `every failed job never ran repository code: ${failed.map((job) => job.name).join(', ')}`
  }
}

// A re-run joins CI's concurrency group, so re-running an older run would
// cancel a newer run on the same ref: only the newest run may be re-run.
export const decide = (jobs, runId, newestRunId) => {
  if (runId == null || newestRunId == null)
    return {
      rerun: false,
      reason: `not re-running run ${runId ?? 'missing'}: the newest CI run for its branch and event is ${newestRunId ?? 'missing'}`
    }
  if (String(runId) !== String(newestRunId))
    return {
      rerun: false,
      reason: `not re-running run ${runId}: a newer CI run for its branch and event exists (${newestRunId})`
    }
  return classifyRun(jobs)
}

// GITHUB_OUTPUT is line-oriented: a job name (which lands in the reason)
// carrying \r or \n must not be able to inject extra `rerun=` lines.
export const formatOutput = (result) =>
  `rerun=${result.rerun}\nreason=${sanitizeReason(result.reason)}\n`

export const sanitizeReason = (reason) =>
  reason.replace(/\r/g, ' ').replace(/\n/g, ' ')

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop())
) {
  const { readFileSync, appendFileSync } = await import('node:fs')
  const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const result = decide(jobs, process.env.RUN_ID, process.env.NEWEST_RUN_ID)
  console.log(
    `${result.rerun ? 'RERUN' : 'KEEP'}: ${sanitizeReason(result.reason)}`
  )
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, formatOutput(result))
}
