// Chooses which activities.next main commit the daily activities.prod sync
// dispatches: the newest commit on which every required push workflow's
// current run finished successfully. Pure so it can be unit tested; the API
// calls live in `.github/workflows/sync-main-to-prod-dispatch.yml`.

// Workflow `name:` -> file under `.github/workflows/`. The dispatch workflow
// lists each file's `push` runs on main (so CodeQL's weekly `schedule` runs do
// not count) and tags them with the name; the test keeps both sides in step
// with the workflow files.
export const REQUIRED_WORKFLOW_FILES = {
  CI: 'ci.yml',
  Package: 'package.yml',
  CodeQL: 'codeql.yml'
}

export const REQUIRED_WORKFLOWS = Object.keys(REQUIRED_WORKFLOW_FILES)

// The run that decides one workflow on one commit is the newest one. Run ids
// increase over time, so the highest id wins. `run_attempt` is not compared:
// the list endpoint returns each run once, already at its latest attempt, so a
// re-run is reflected in its own entry and two entries are always two
// different runs (e.g. main was reset back to a commit and pushed again).
const isNewerRun = (run, previous) => !previous || run.id > previous.id

const describeRun = (run) =>
  run
    ? `${run.status}/${run.conclusion ?? 'n/a'} (attempt ${run.run_attempt})`
    : 'missing'

const isSuccessful = (run) =>
  Boolean(run) && run.status === 'completed' && run.conclusion === 'success'

/**
 * @typedef {object} WorkflowRun
 * @property {number} id
 * @property {string} workflow    Required-workflow name the run belongs to.
 * @property {string} head_sha
 * @property {number} run_attempt Latest attempt of this run.
 * @property {string} status
 * @property {string | null} conclusion
 */

/**
 * @typedef {object} EvaluatedCommit
 * @property {string} sha
 * @property {Record<string, string>} states  Workflow name -> run summary.
 */

/**
 * @param {object} input
 * @param {string[]} input.commits  main commit SHAs, newest first.
 * @param {WorkflowRun[]} input.runs
 * @param {string[]} [input.requiredWorkflows]
 * @returns {{ sha: string | null, evaluated: EvaluatedCommit[] }}
 *   `sha` is the newest fully green commit, or null when none is in the
 *   window. `evaluated` lists every commit inspected, newest first, for the
 *   job summary.
 */
export const selectSyncCommit = ({
  commits,
  runs,
  requiredWorkflows = REQUIRED_WORKFLOWS
}) => {
  // Keyed by workflow name, so runs of non-gating workflows are never read.
  /** @type {Map<string, WorkflowRun>} */
  const latest = new Map()
  for (const run of runs) {
    const key = `${run.head_sha}\t${run.workflow}`
    if (isNewerRun(run, latest.get(key))) latest.set(key, run)
  }

  /** @type {EvaluatedCommit[]} */
  const evaluated = []
  for (const sha of commits) {
    /** @type {Record<string, string>} */
    const states = {}
    let green = true
    for (const workflow of requiredWorkflows) {
      const run = latest.get(`${sha}\t${workflow}`)
      states[workflow] = describeRun(run)
      if (!isSuccessful(run)) green = false
    }
    evaluated.push({ sha, states })
    if (green) return { sha, evaluated }
  }

  return { sha: null, evaluated }
}
