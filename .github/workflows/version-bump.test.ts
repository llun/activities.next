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
          label: { name: 'release:major' },
          actor: { type: 'User' },
          created_at: '2026-09-09T12:00:00Z'
        },
        {
          event: 'unlabeled',
          label: { name: 'release:major' },
          actor: { type: 'User' },
          created_at: '2026-09-09T12:01:00Z'
        },
        {
          event: 'labeled',
          label: { name: 'release:major' },
          actor: { type: 'Bot' },
          created_at: '2026-09-09T12:02:00Z'
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
})
