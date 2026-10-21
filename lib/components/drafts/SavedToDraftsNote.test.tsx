/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import {
  DraftConflictError,
  type DraftRecord,
  announceDraftsChanged,
  deleteDraftAndOwnedMedia,
  getDraft
} from '@/lib/client/drafts'

import {
  NotSavedToDraftsNote,
  SAVED_NOTE_MS,
  SavedToDraftsNote
} from './SavedToDraftsNote'

vi.mock('@/lib/client/drafts', () => ({
  DraftConflictError: class DraftConflictError extends Error {},
  deleteDraftAndOwnedMedia: vi.fn(),
  getDraft: vi.fn(),
  announceDraftsChanged: vi.fn()
}))

const record = {
  id: 'd1',
  revision: 1,
  attachments: []
} as unknown as DraftRecord

const renderNote = (onDismiss = vi.fn()) => {
  render(
    <SavedToDraftsNote
      draftId="d1"
      accountId="account-1"
      actorId="actor-1"
      onDismiss={onDismiss}
    />
  )
  return onDismiss
}

describe('SavedToDraftsNote', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(getDraft).mockReset().mockResolvedValue(record)
    vi.mocked(deleteDraftAndOwnedMedia).mockReset().mockResolvedValue()
    vi.mocked(announceDraftsChanged).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a polite status fixed bottom-right at a 20px inset', () => {
    renderNote()

    const note = screen.getByRole('status')
    expect(note).toHaveAttribute('aria-live', 'polite')
    expect(note).toHaveTextContent('Saved to Drafts')
    expect(note).toHaveClass('fixed', 'right-5', 'bottom-5')
  })

  it('hides after SAVED_NOTE_MS, not before', () => {
    const onDismiss = renderNote()

    act(() => {
      vi.advanceTimersByTime(SAVED_NOTE_MS - 1)
    })
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Discard deletes the draft and its owned media, tells other views, and closes', async () => {
    const onDismiss = renderNote()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })

    expect(getDraft).toHaveBeenCalledWith('d1')
    expect(deleteDraftAndOwnedMedia).toHaveBeenCalledWith(record)
    expect(announceDraftsChanged).toHaveBeenCalledWith(
      'account-1',
      'actor-1',
      'd1'
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('Discard on a draft that is already gone just closes', async () => {
    vi.mocked(getDraft).mockResolvedValue(undefined)
    const onDismiss = renderNote()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })

    expect(deleteDraftAndOwnedMedia).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('says so when the discard fails, and keeps the draft note open', async () => {
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValue(new Error('nope'))
    const onDismiss = renderNote()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Couldn’t discard. Try again.'
    )
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('keeps the draft when deleting it hits a revision conflict', async () => {
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValue(
      new DraftConflictError()
    )
    const onDismiss = renderNote()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Changed in another tab'
    )
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(announceDraftsChanged).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('does not delete a draft another tab edited after the note appeared', async () => {
    renderNote()
    await act(async () => {})
    vi.mocked(getDraft).mockResolvedValue({
      ...record,
      revision: 2
    } as DraftRecord)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    })

    expect(deleteDraftAndOwnedMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Changed in another tab'
    )
  })

  it('the dismiss button closes without deleting', () => {
    const onDismiss = renderNote()

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss notification' })
    )

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(deleteDraftAndOwnedMedia).not.toHaveBeenCalled()
  })
})

describe('NotSavedToDraftsNote', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    writeText.mockReset().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says the draft was not saved, copies the text, and stays until dismissed', async () => {
    const onDismiss = vi.fn()
    render(<NotSavedToDraftsNote text="Half a thought" onDismiss={onDismiss} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Couldn’t save to Drafts'
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))
    })
    expect(writeText).toHaveBeenCalledWith('Half a thought')

    // The note is the only place left with the text: it never hides itself.
    act(() => vi.advanceTimersByTime(SAVED_NOTE_MS * 2))
    expect(onDismiss).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss notification' })
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('offers no Copy text when there is no text', () => {
    render(<NotSavedToDraftsNote text="" onDismiss={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'Copy text' })).toBeNull()
  })
})
