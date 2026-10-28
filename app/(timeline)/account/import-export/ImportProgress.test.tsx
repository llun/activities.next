/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ImportProgress } from './ImportProgress'

const accountImport = (phase: string | null) => ({
  id: 'import-1',
  status: 'running' as const,
  kind: 'mastodon' as const,
  phase,
  progress: {
    version: 1 as const,
    sourceActorId: null,
    sourceFollowersUrl: null,
    statusOrder: 'newest-first' as const,
    catalogStage: 'statuses' as const,
    catalogIndex: 0,
    totalItems: 0,
    completedItems: 0,
    skippedItems: 0,
    continuationCount: 0
  },
  createdAt: '2026-10-28T10:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  lastErrorCode: null
})

describe('ImportProgress', () => {
  it.each([
    ['inspect', 'Reading the archive'],
    ['catalog', 'Listing what is inside'],
    ['profile', 'Restoring your profile'],
    ['gears', 'Restoring gear'],
    ['media', 'Importing photos and videos'],
    ['statuses', 'Importing posts'],
    ['albums', 'Restoring albums'],
    ['collections', 'Finishing up'],
    ['finish', 'Finishing up'],
    [null, 'Waiting to start…']
  ])('labels %s', (phase, label) => {
    render(
      <ImportProgress
        accountImport={accountImport(phase)}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows the archive kind, counts and a confirm dialog before cancelling', () => {
    const onCancel = vi.fn()
    const current = accountImport('statuses')
    current.progress.totalItems = 12
    current.progress.completedItems = 4
    render(
      <ImportProgress
        accountImport={current}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText(/Found in this file/)).toHaveTextContent(
      'Found in this file: Mastodon archive · 12 items'
    )
    expect(screen.getByText('4 of 12 completed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }))
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByText(
        'Items already imported stay. The rest is not imported.'
      )
    ).toBeInTheDocument()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel import' })
    )
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
