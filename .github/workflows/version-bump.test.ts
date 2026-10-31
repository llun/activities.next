import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasHumanMajorLabelEvent } from '../scripts/major-release-approval.mjs'
import {
  getCommitBump,
  isMajorTransition,
  nextVersion,
  selectVersionBump
} from '../scripts/version-bump-policy.mjs'

describe('automatic version-bump policy', () => {
  it('turns an unapproved major marker into a minor release', () => {
    const result = selectVersionBump([
      {
        subject: 'major: remove legacy endpoints',
        body: '',
        changedFiles: ['lib/api.ts']
      }
    ])

    expect(result).toEqual({ bump: 'minor', commitCount: 1 })
    expect(nextVersion('v1.161.52', result.bump)).toBe('1.162.0')
  })

  it('requires approval for major markers in subjects and squash bodies', () => {
    expect(
      getCommitBump({
        subject: 'major: remove legacy endpoints',
        body: '',
        changedFiles: ['lib/api.ts'],
        majorApproved: true
      })
    ).toBe('major')
    expect(
      getCommitBump({
        subject: 'feat: use new API',
        body: '- minor: add a compatible option\n- major: remove the old API',
        changedFiles: ['lib/api.ts'],
        majorApproved: true
      })
    ).toBe('major')
    expect(
      getCommitBump({
        subject: 'feat: use new API',
        body: '- major: remove the old API',
        changedFiles: ['lib/api.ts']
      })
    ).toBe('minor')
  })

  it('recognizes a major version transition for the tag guard', () => {
    expect(isMajorTransition('v1.161.52', 'v1.162.0')).toBe(false)
    expect(isMajorTransition('v1.161.52', 'v2.0.0')).toBe(true)
  })

  it('accepts approval only when a user applied the current major label', () => {
    const pullRequest = {
      merged_at: '2026-09-09T12:00:00Z',
      labels: [{ name: 'release:major' }]
    }

    expect(
      hasHumanMajorLabelEvent(pullRequest, [
        {
          event: 'labeled',
          id: 1,
          label: { name: 'release:major' },
          actor: { type: 'Bot' },
          created_at: '2026-09-09T12:00:00Z'
        }
      ])
    ).toBe(false)
    expect(
      hasHumanMajorLabelEvent(pullRequest, [
        {
          event: 'labeled',
          id: 1,
          label: { name: 'release:major' },
          actor: { type: 'User' },
          created_at: '2026-09-09T12:00:00Z'
        }
      ])
    ).toBe(true)
    expect(
      hasHumanMajorLabelEvent(pullRequest, [
        {
          event: 'labeled',
          id: 1,
          label: { name: 'release:major' },
          actor: { type: 'User' },
          created_at: '2026-09-09T12:00:00Z'
        },
        {
          event: 'unlabeled',
          id: 2,
          label: { name: 'release:major' },
          actor: { type: 'User' },
          created_at: '2026-09-09T12:01:00Z'
        },
        {
          event: 'labeled',
          id: 3,
          label: { name: 'release:major' },
          actor: { type: 'Bot' },
          created_at: '2026-09-09T12:02:00Z'
        }
      ])
    ).toBe(false)
    expect(
      hasHumanMajorLabelEvent(pullRequest, [
        {
          event: 'labeled',
          id: 1,
          label: { name: 'release:major' },
          actor: { type: 'User' },
          created_at: '2026-09-09T12:00:00Z'
        },
        {
          event: 'labeled',
          id: 2,
          label: { name: 'release:major' },
          actor: { type: 'Bot' },
          created_at: '2026-09-09T12:00:00Z'
        }
      ])
    ).toBe(false)
  })

  it('runs the executable policy and tag approval guards in both workflows', () => {
    expect(
      readFileSync('.github/workflows/version-bump.yml', 'utf8')
    ).toContain('node .github/scripts/determine-version-bump.mjs')
    expect(readFileSync('.github/workflows/tag-version.yml', 'utf8')).toContain(
      'node .github/scripts/verify-major-tag-approval.mjs'
    )
  })

  it('does not request Actions write access it never uses', () => {
    const workflow = readFileSync('.github/workflows/version-bump.yml', 'utf8')

    expect(workflow).not.toMatch(/^\s+actions:\s*write\s*$/m)
  })

  describe('same-repository pull request filters', () => {
    const hasJq = spawnSync('jq', ['--version']).status === 0
    const workflow = readFileSync('.github/workflows/version-bump.yml', 'utf8')
    const filters = [...workflow.matchAll(/--jq '([^']+)'/g)]
      .map((match) => match[1])
      .filter((filter) => filter.includes('isCrossRepository'))
    const runFilter = (filter: string, input: unknown) =>
      spawnSync('jq', ['-r', filter], {
        input: JSON.stringify(input),
        encoding: 'utf8'
      }).stdout.trim()

    it('applies isCrossRepository to both the stale-PR close and existing-PR lookups', () => {
      expect(filters).toHaveLength(2)
    })

    it.skipIf(!hasJq)(
      'never selects a fork pull request that squats on the bump branch name',
      () => {
        const [staleFilter, existingFilter] = filters

        expect(
          runFilter(existingFilter, [
            { number: 7, isCrossRepository: true },
            { number: 9, isCrossRepository: false }
          ])
        ).toBe('9')
        expect(
          runFilter(existingFilter, [{ number: 7, isCrossRepository: true }])
        ).toBe('')
        expect(
          runFilter(staleFilter, [
            {
              number: 3,
              headRefName: 'version-bump/v1.2.3',
              isCrossRepository: true
            },
            {
              number: 4,
              headRefName: 'version-bump/v1.2.3',
              isCrossRepository: false
            }
          ])
        ).toBe('4')
      }
    )
  })

  describe.skipIf(spawnSync('jq', ['--version']).status !== 0)(
    'required check gate and CI re-runs',
    () => {
      const tab = '\t'
      const workflow = readFileSync(
        '.github/workflows/version-bump.yml',
        'utf8'
      )
      const script = workflow
        .slice(workflow.indexOf('HEAD_SHA=$(git rev-parse HEAD)'))
        .split('\n')
        .map((line) => line.replace(/^ {10}/, ''))
        .join('\n')

      expect(script).toContain('gh pr merge')

      const greenChecks = [
        `All Tests${tab}1${tab}completed${tab}success`,
        `Build${tab}2${tab}completed${tab}success`,
        `Lint and Prettier${tab}3${tab}completed${tab}success`
      ]
      const failedAllTests = [
        `All Tests${tab}1${tab}completed${tab}failure`,
        ...greenChecks.slice(1)
      ]
      const pendingAllTests = [
        `All Tests${tab}10${tab}in_progress${tab}`,
        ...greenChecks.slice(1)
      ]
      const rerunGreen = [
        `All Tests${tab}10${tab}completed${tab}success`,
        ...greenChecks.slice(1)
      ]

      const infrastructureJobs = [
        JSON.stringify({
          name: 'PostgreSQL Tests (shard 1/2)',
          status: 'queued',
          conclusion: null,
          runner_name: null,
          steps: []
        }),
        JSON.stringify({
          name: 'All Tests',
          status: 'completed',
          conclusion: 'failure',
          runner_name: 'GitHub Actions 7',
          steps: [
            { name: 'Set up job', conclusion: 'success' },
            { name: 'Verify all test shards succeeded', conclusion: 'failure' }
          ]
        })
      ]
      const codeFailureJobs = [
        JSON.stringify({
          name: 'Test Shard 1 of 4',
          status: 'completed',
          conclusion: 'failure',
          runner_name: 'GitHub Actions 7',
          steps: [
            { name: 'Set up job', conclusion: 'success' },
            { name: 'Run test shard', conclusion: 'failure' }
          ]
        })
      ]

      const runLine = (status: string, attempt: number) =>
        `1${tab}${status}${tab}${attempt}`

      let dir: string
      let bin: string
      let scriptPath: string

      const writeFake = (name: string, body: string) => {
        const fakePath = join(bin, name)
        writeFileSync(fakePath, `#!/usr/bin/env bash\n${body}`)
        chmodSync(fakePath, 0o755)
      }

      const writeStep = (
        step: number,
        checks: string[],
        run: string,
        jobs: string[]
      ) => {
        writeFileSync(
          join(dir, `step-${step}.checks`),
          `${checks.join('\n')}\n`
        )
        writeFileSync(
          join(dir, `step-${step}.run`),
          run === '' ? '' : `${run}\n`
        )
        writeFileSync(join(dir, `step-${step}.jobs`), `${jobs.join('\n')}\n`)
        writeFileSync(join(dir, 'last-step'), `${step}\n`)
      }

      const runGate = () => {
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_REPOSITORY: 'o/r',
          PR_URL: 'https://example.test/pr/1',
          BASE_SHA: 'base-sha',
          CHECK_ATTEMPTS: '6',
          CHECK_RERUN_ATTEMPTS: '6',
          CHECK_INTERVAL_SECONDS: '0',
          CHECK_KICK_ATTEMPT: '100',
          CHECK_REOPEN_ATTEMPTS: '1'
        }
        delete env.GITHUB_OUTPUT

        const result = spawnSync('bash', ['-euo', 'pipefail', scriptPath], {
          cwd: process.cwd(),
          encoding: 'utf8',
          env
        })

        return {
          merges: existsSync(join(dir, 'merges'))
            ? readFileSync(join(dir, 'merges'), 'utf8')
                .split('\n')
                .filter(Boolean).length
            : 0,
          polls: Number(readFileSync(join(dir, 'polls'), 'utf8')),
          status: result.status,
          stdout: result.stdout
        }
      }

      beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'version-bump-gate-'))
        bin = join(dir, 'bin')
        mkdirSync(bin)
        scriptPath = join(dir, 'gate.sh')
        writeFileSync(scriptPath, script)
        chmodSync(scriptPath, 0o755)

        writeFake('sleep', 'exit 0\n')
        writeFake(
          'git',
          `dir='${dir}'
if [ "$1" = rev-parse ] && [ "$2" = HEAD ]; then
  echo head-sha
  exit 0
fi
if [ "$1" = rev-parse ] && [ "$2" = origin/main ]; then
  cat "$dir/main-sha"
  exit 0
fi
exit 0
`
        )
        writeFake(
          'gh',
          `dir='${dir}'
step_file() {
  n=$(cat "$dir/polls")
  last=$(cat "$dir/last-step")
  if [ "$n" -gt "$last" ]; then
    n=$last
  fi
  cat "$dir/step-$n.$1"
}
if [ "$1" = pr ]; then
  case "$2" in
    view) cat "$dir/pr-head"; exit 0 ;;
    merge) echo merge >> "$dir/merges"; echo moved-sha > "$dir/main-sha"; exit 0 ;;
    close|reopen) exit 0 ;;
  esac
fi
for arg in "$@"; do
  case "$arg" in
    *branches/main/protection*)
      echo 'All Tests'
      echo 'Build'
      echo 'Lint and Prettier'
      exit 0
      ;;
    *check-runs*)
      polls=$(( $(cat "$dir/polls") + 1 ))
      echo "$polls" > "$dir/polls"
      step_file checks
      exit 0
      ;;
    *actions/workflows/ci.yml/runs*)
      if [ -f "$dir/runs-api-fails" ]; then
        exit 1
      fi
      step_file run
      exit 0
      ;;
    */jobs*)
      step_file jobs
      exit 0
      ;;
  esac
done
exit 0
`
        )

        writeFileSync(join(dir, 'main-sha'), 'base-sha\n')
        writeFileSync(join(dir, 'pr-head'), 'head-sha\n')
        writeFileSync(join(dir, 'polls'), '0\n')
      })

      afterEach(() => {
        rmSync(dir, { recursive: true, force: true })
      })

      it('merges once when attempt 1 fails on infrastructure and the re-run succeeds', () => {
        writeStep(
          1,
          failedAllTests,
          runLine('completed', 1),
          infrastructureJobs
        )
        writeStep(
          2,
          pendingAllTests,
          runLine('in_progress', 2),
          infrastructureJobs
        )
        writeStep(3, rerunGreen, runLine('completed', 2), infrastructureJobs)

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(1)
        expect(result.polls).toBe(3)
      })

      it('merges once when attempt 1 succeeds', () => {
        writeStep(1, greenChecks, runLine('completed', 1), [])

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(1)
        expect(result.polls).toBe(1)
      })

      it('does not merge a real failure, and stops at the first look', () => {
        writeStep(1, failedAllTests, runLine('completed', 1), codeFailureJobs)

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(0)
        expect(result.polls).toBe(1)
      })

      it('keeps waiting while the failed run is still in progress, then gives up on a real failure', () => {
        writeStep(
          1,
          failedAllTests,
          runLine('in_progress', 1),
          infrastructureJobs
        )
        writeStep(2, failedAllTests, runLine('completed', 1), codeFailureJobs)

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(0)
        expect(result.polls).toBe(2)
      })

      it('does not merge when the re-run fails too', () => {
        writeStep(
          1,
          failedAllTests,
          runLine('completed', 1),
          infrastructureJobs
        )
        writeStep(2, failedAllTests, runLine('completed', 2), codeFailureJobs)

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(0)
        expect(result.polls).toBe(2)
      })

      it('does not bump twice for a duplicate event', () => {
        writeStep(
          1,
          failedAllTests,
          runLine('completed', 1),
          infrastructureJobs
        )
        writeStep(
          2,
          pendingAllTests,
          runLine('in_progress', 2),
          infrastructureJobs
        )
        writeStep(3, rerunGreen, runLine('completed', 2), infrastructureJobs)

        const first = runGate()
        expect(first.status).toBe(0)
        expect(first.merges).toBe(1)

        writeFileSync(join(dir, 'polls'), '0\n')
        writeStep(1, greenChecks, runLine('completed', 2), [])

        const second = runGate()

        expect(second.status).toBe(0)
        expect(second.merges).toBe(1)
      })

      it('does not merge a head a newer run took over', () => {
        writeFileSync(join(dir, 'pr-head'), 'other-sha\n')
        writeStep(1, greenChecks, runLine('completed', 1), [])

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(0)
      })

      it('gives up after the extended budget when no re-run ever comes', () => {
        writeStep(
          1,
          failedAllTests,
          runLine('completed', 1),
          infrastructureJobs
        )

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(0)
        expect(result.polls).toBe(12)
      })

      it('keeps polling when the run lookup fails', () => {
        writeFileSync(join(dir, 'runs-api-fails'), '')
        writeStep(
          1,
          failedAllTests,
          runLine('completed', 1),
          infrastructureJobs
        )

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(0)
        expect(result.polls).toBe(12)
      })

      it('gives up when no CI run is found', () => {
        writeStep(1, failedAllTests, '', [])

        const result = runGate()

        expect(result.status).toBe(0)
        expect(result.merges).toBe(0)
        expect(result.polls).toBe(1)
      })
    }
  )
})
