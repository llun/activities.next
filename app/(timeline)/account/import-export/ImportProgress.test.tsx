/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AccountImportResponse } from '@/lib/client/accountImports'

import { ImportProgress } from './ImportProgress'

const accountImport = (phase: string | null): AccountImportResponse => ({
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

afterEach(() => {
  vi.useRealTimers()
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

  it('announces the phase and count in a live region that excludes the bar', () => {
    const current = accountImport('statuses')
    current.progress.totalItems = 12
    current.progress.completedItems = 4
    render(
      <ImportProgress
        accountImport={current}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        onCancel={vi.fn()}
      />
    )

    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('Importing posts')
    expect(region).toHaveTextContent('4 of 12 completed')
    expect(region).not.toContainElement(screen.getByRole('progressbar'))
  })

  it('disables Cancel import while offline and says why', () => {
    const onCancel = vi.fn()
    render(
      <ImportProgress
        accountImport={accountImport('statuses')}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        offline
        onCancel={onCancel}
      />
    )

    const button = screen.getByRole('button', { name: 'Cancel import' })
    expect(button).toBeDisabled()
    expect(screen.getByText("You're offline")).toBeInTheDocument()
    fireEvent.click(button)
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('takes focus on mount when focusOnMount is set', async () => {
    render(
      <ImportProgress
        accountImport={accountImport('statuses')}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        focusOnMount
        onCancel={vi.fn()}
      />
    )
    const heading = screen.getByText('Import in progress')
    await waitFor(() => {
      expect(document.activeElement).toBe(heading.parentElement)
      expect(document.activeElement).toHaveAttribute('tabindex', '-1')
    })
  })

  it('does not take focus on mount by default', () => {
    render(
      <ImportProgress
        accountImport={accountImport('statuses')}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        onCancel={vi.fn()}
      />
    )
    expect(document.activeElement).toBe(document.body)
  })

  it('advances the started time as polling updates the import', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-28T10:00:00.000Z'))
    const current = accountImport('statuses')
    current.startedAt = '2026-10-28T10:00:00.000Z'
    const { rerender } = render(
      <ImportProgress
        accountImport={current}
        currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByText(/less than a minute ago/)).toBeInTheDocument()

    vi.setSystemTime(Date.parse('2026-10-28T10:05:00.000Z'))
    await act(async () => {
      rerender(
        <ImportProgress
          accountImport={{ ...current }}
          currentTime={Date.parse('2026-10-28T10:00:00.000Z')}
          onCancel={vi.fn()}
        />
      )
    })

    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument()
  })
})
