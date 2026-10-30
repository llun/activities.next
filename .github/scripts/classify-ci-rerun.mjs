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

export const classifyRun = (jobs) => {
  const failed = jobs.filter(
    (job) =>
      !AGGREGATE_JOBS.has(job.name) &&
      job.conclusion !== 'success' &&
      job.conclusion !== 'skipped'
  )
  if (failed.length === 0)
    return { rerun: false, reason: 'no failed job outside the aggregates' }
  for (const job of failed) {
    const steps = job.steps ?? []
    if (job.status !== 'completed' && !job.runner_name && steps.length === 0)
      continue // never started
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

if (
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop())
) {
  const { readFileSync, appendFileSync } = await import('node:fs')
  const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const result = classifyRun(jobs)
  console.log(`${result.rerun ? 'RERUN' : 'KEEP'}: ${result.reason}`)
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `rerun=${result.rerun}\nreason=${result.reason}\n`
    )
}
