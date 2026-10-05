import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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
})
