/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ImportReport } from './ImportReport'

describe('ImportReport', () => {
  it('renders imported, skipped, failed and profile image rows from the report', () => {
    render(
      <ImportReport
        accountImport={{
          id: 'import-1',
          status: 'done',
          kind: 'activities.next',
          phase: 'finish',
          progress: {
            version: 1,
            sourceActorId: null,
            sourceFollowersUrl: null,
            statusOrder: 'newest-first',
            catalogStage: 'done',
            catalogIndex: 0,
            totalItems: 10,
            completedItems: 10,
            skippedItems: 0,
            continuationCount: 0,
            profileImageSkips: [
              'media_invalid',
              'media_invalid',
              'media_quota_exceeded'
            ]
          },
          createdAt: '2026-10-28T10:00:00.000Z',
          startedAt: '2026-10-28T10:00:00.000Z',
          finishedAt: '2026-10-28T10:03:00.000Z',
          lastErrorCode: null,
          report: {
            done: { status: 2, like: 1, media: 3, 'fitness-file': 2 },
            skipped: { boost: 4, 'reply-to-other': 2 },
            failed: { item_failed: 1 }
          }
        }}
        onStartAgain={vi.fn()}
      />
    )

    expect(screen.getByText('Import finished')).toBeInTheDocument()
    for (const row of [
      '2 posts imported',
      '1 like imported',
      '3 photos and videos imported',
      '2 fitness files imported',
      '4 skipped: boosts are not imported',
      "2 skipped: replies to other people's posts were not imported",
      '1 failed: this item could not be imported',
      '2 profile images skipped: the image could not be read',
      '1 profile image skipped: the storage limit was reached'
    ]) {
      expect(screen.getByText(row)).toBeInTheDocument()
    }
  })

  it('labels terminal errors in plain English and offers Start again', () => {
    render(
      <ImportReport
        accountImport={{
          id: 'import-2',
          status: 'failed',
          kind: null,
          phase: null,
          progress: {
            version: 1,
            sourceActorId: null,
            sourceFollowersUrl: null,
            statusOrder: 'newest-first',
            catalogStage: 'statuses',
            catalogIndex: 0,
            totalItems: 0,
            completedItems: 0,
            skippedItems: 0,
            continuationCount: 0
          },
          createdAt: '2026-10-28T10:00:00.000Z',
          startedAt: null,
          finishedAt: '2026-10-28T10:03:00.000Z',
          lastErrorCode: 'archive_not_a_zip',
          report: { done: {}, skipped: {}, failed: {} }
        }}
        onStartAgain={vi.fn()}
      />
    )

    expect(
      screen.getByText('We could not finish the import')
    ).toBeInTheDocument()
    expect(
      screen.getByText('This file is not a ZIP archive.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Start again' })
    ).toBeInTheDocument()
  })

  it('shows a cancelled import and its partial rows', () => {
    render(
      <ImportReport
        accountImport={{
          id: 'import-3',
          status: 'cancelled',
          kind: 'mastodon',
          phase: null,
          progress: {
            version: 1,
            sourceActorId: null,
            sourceFollowersUrl: null,
            statusOrder: 'newest-first',
            catalogStage: 'done',
            catalogIndex: 0,
            totalItems: 2,
            completedItems: 1,
            skippedItems: 0,
            continuationCount: 0
          },
          createdAt: '2026-10-28T10:00:00.000Z',
          startedAt: '2026-10-28T10:00:00.000Z',
          finishedAt: '2026-10-28T10:01:00.000Z',
          lastErrorCode: null,
          report: { done: { status: 1 }, skipped: {}, failed: {} }
        }}
        onStartAgain={vi.fn()}
      />
    )

    expect(screen.getByText('Import cancelled')).toBeInTheDocument()
    expect(screen.getByText('1 post imported')).toBeInTheDocument()
  })
})
