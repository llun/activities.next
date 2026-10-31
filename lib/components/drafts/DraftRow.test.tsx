/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'

import {
  DraftConflictError,
  type DraftQueueState,
  announceDraftsChanged,
  deleteDraftAndOwnedMedia,
  getDraft,
  getDraftBlob,
  resumeQueue
} from '@/lib/client/drafts'

import { DraftRow } from './DraftRow'
import { NOW, draftRecord, targetStatus } from './draftFixtures.testUtils'

vi.mock('@/lib/client/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/drafts')>()),
  deleteDraftAndOwnedMedia: vi.fn(),
  getDraft: vi.fn(),
  getDraftBlob: vi.fn(),
  announceDraftsChanged: vi.fn(),
  resumeQueue: vi.fn()
}))

const requestDrain = vi.fn()
vi.mock('./DraftsProvider', () => ({
  useDrafts: () => ({ requestDrain })
}))

const writeText = vi.fn()

const onDeleteError = vi.fn()

const onActionError = vi.fn()

const renderRow = (
  patch: Parameters<typeof draftRecord>[0] = {},
  onEdit = vi.fn(),
  onConflict = vi.fn()
) =>
  render(
    <DraftRow
      draft={draftRecord(patch)}
      currentTime={NOW}
      onEdit={onEdit}
      onConflict={onConflict}
      onDeleteError={onDeleteError}
      onActionError={onActionError}
    />
  )

const queueState = (
  patch: Partial<DraftQueueState> & Pick<DraftQueueState, 'state'>
): DraftQueueState => ({
  queuedAt: NOW - 12 * 60_000,
  attempts: 0,
  ...patch
})

const renderQueued = (
  patch: Partial<DraftQueueState> & Pick<DraftQueueState, 'state'>,
  onEdit = vi.fn()
) =>
  renderRow(
    { queue: queueState(patch), updatedAt: NOW - 5 * 3_600_000 },
    onEdit
  )

const buttons = () =>
  [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')].map(
    (el) => el.textContent
  )

describe('DraftRow', () => {
  beforeEach(() => {
    vi.mocked(deleteDraftAndOwnedMedia).mockResolvedValue(undefined)
    vi.mocked(resumeQueue).mockResolvedValue(1)
    vi.mocked(getDraftBlob).mockResolvedValue(undefined)
    writeText.mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('shows the text, visibility and the time relative to currentTime', () => {
    renderRow({ visibility: 'private' })

    expect(screen.getByText('A post I have not sent')).toBeInTheDocument()
    expect(
      screen.getByText('Followers only · Saved 12 minutes ago')
    ).toBeInTheDocument()
  })

  it('counts photos, a poll and a FIT file in the meta line', () => {
    renderRow({
      attachments: [
        {
          localId: 'a',
          owned: true,
          mediaType: 'image/png',
          fileName: 'a.png',
          description: '',
          decorative: false,
          hasBlob: false
        },
        {
          localId: 'b',
          owned: true,
          mediaType: 'image/jpeg',
          fileName: 'b.jpg',
          description: '',
          decorative: false,
          hasBlob: false
        }
      ],
      poll: { choices: ['a', 'b'], durationInSeconds: 3600, pollType: 'oneOf' },
      fitnessFile: {
        localId: 'f',
        fileName: 'run.fit',
        mimeType: 'application/octet-stream',
        size: 1,
        owned: true,
        hasBlob: false
      }
    })

    expect(
      screen.getByText(
        'Public · 2 photos · FIT file · Poll · Saved 12 minutes ago'
      )
    ).toBeInTheDocument()
  })

  it('names the account a reply answers and a post quotes', () => {
    const { unmount } = renderRow({
      composer: 'reply-box',
      replyTo: targetStatus('alice', 'remote.example')
    })
    expect(
      screen.getByText('Replying to @alice@remote.example')
    ).toBeInTheDocument()
    unmount()

    renderRow({ quoteOf: targetStatus('bob', 'other.example') })
    expect(screen.getByText('Quoting @bob@other.example')).toBeInTheDocument()
  })

  it('shows plain text, never rendered HTML', () => {
    renderRow({ text: '<b>bold</b>' })

    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('draws a stored blob as an object URL and revokes it on unmount', async () => {
    vi.mocked(getDraftBlob).mockResolvedValue({
      id: 'a',
      draftId: 'draft-1',
      accountId: 'account-1',
      bytes: new ArrayBuffer(4),
      mimeType: 'image/png',
      fileName: 'a.png',
      lastModified: 1
    })
    const createObjectURL = vi.fn(() => 'blob:thumb')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })

    const { unmount } = renderRow({
      attachments: [
        {
          localId: 'a',
          owned: true,
          mediaType: 'image/png',
          fileName: 'a.png',
          // The bytes win over a server URL.
          url: 'https://llun.test/media/a.png',
          description: 'A cat',
          decorative: false,
          hasBlob: true
        }
      ]
    })

    expect(await screen.findByAltText('A cat')).toHaveAttribute(
      'src',
      'blob:thumb'
    )
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumb')
  })

  it('falls back to the server poster for an uploaded video without bytes', async () => {
    renderRow({
      attachments: [
        {
          localId: 'v',
          owned: true,
          mediaType: 'video/mp4',
          fileName: 'v.mp4',
          url: 'https://llun.test/media/v.mp4',
          posterUrl: 'https://llun.test/media/v.jpg',
          description: '',
          decorative: false,
          hasBlob: false
        }
      ]
    })

    expect(await screen.findByAltText('v.mp4')).toHaveAttribute(
      'src',
      'https://llun.test/media/v.jpg'
    )
  })

  it('opens the editor from Edit', () => {
    const onEdit = vi.fn()
    renderRow({}, onEdit)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('Copy writes the draft text, shows Copied, then reverts', async () => {
    vi.useFakeTimers()
    renderRow()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    })

    expect(writeText).toHaveBeenCalledWith('A post I have not sent')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1599)
    })
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('asks before deleting, and Keep draft deletes nothing', () => {
    renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this draft?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep draft' }))

    expect(deleteDraftAndOwnedMedia).not.toHaveBeenCalled()
    expect(announceDraftsChanged).not.toHaveBeenCalled()
  })

  it('deletes the draft and its owned media, then tells the other views', async () => {
    const draft = draftRecord()
    render(
      <DraftRow
        draft={draft}
        currentTime={NOW}
        onEdit={vi.fn()}
        onConflict={vi.fn()}
        onDeleteError={onDeleteError}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )
    })

    expect(deleteDraftAndOwnedMedia).toHaveBeenCalledWith(draft)
    // A success clears an earlier failure the list is showing.
    expect(onDeleteError).toHaveBeenCalledWith(null)
    expect(announceDraftsChanged).toHaveBeenCalledWith(
      'account-1',
      draft.actorId,
      'draft-1'
    )
  })

  it('reports a failed delete to the list with a Retry, draws nothing itself, and announces nothing', async () => {
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValue(new Error('no db'))
    renderRow()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )
    })

    expect(onDeleteError).toHaveBeenLastCalledWith(
      'Something went wrong on this device. Try again.',
      expect.any(Function)
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(announceDraftsChanged).not.toHaveBeenCalled()

    // The Retry the list shows deletes the same revision again: a newer save
    // since then is the delete's own conflict, never deleted.
    vi.mocked(deleteDraftAndOwnedMedia).mockResolvedValue(undefined)
    const retry = onDeleteError.mock.lastCall?.[1] as () => void
    await act(async () => retry())
    expect(getDraft).not.toHaveBeenCalled()
    expect(deleteDraftAndOwnedMedia).toHaveBeenLastCalledWith(draftRecord())
    expect(onDeleteError).toHaveBeenLastCalledWith(null)
  })

  it('on a conflict asks the list to re-read, says so, and announces nothing', async () => {
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValue(
      new DraftConflictError()
    )
    const onConflict = vi.fn()
    renderRow({}, vi.fn(), onConflict)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )
    })

    expect(onConflict).toHaveBeenCalledTimes(1)
    // No Retry: the list re-reads the newest save for a fresh Delete.
    expect(onDeleteError).toHaveBeenLastCalledWith(
      'This draft was changed. Review it, then delete again.'
    )
    expect(announceDraftsChanged).not.toHaveBeenCalled()
  })

  it('does not ask for a re-read when the failure is not a conflict', async () => {
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValue(new Error('no db'))
    const onConflict = vi.fn()
    renderRow({}, vi.fn(), onConflict)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )
    })

    expect(onConflict).not.toHaveBeenCalled()
  })

  describe('a queued post', () => {
    it.each([
      ['waiting', 'gray', 'Waiting for connection'],
      ['paused', 'gray', 'Paused'],
      ['sending', 'info', 'Sending'],
      ['checking', 'info', 'Checking whether it posted'],
      ['needs_review', 'warning', 'Needs review'],
      ['couldnt_send', 'destructive', "Couldn't send"]
    ] as const)('shows the %s chip as %s "%s"', (state, tone, label) => {
      const { container } = renderQueued({ state })

      const chip = container.querySelector('[data-slot="badge"]')
      expect(chip).toHaveTextContent(label)
      expect(chip).toHaveAttribute('data-tone', tone)
    })

    it('has no chip on a plain draft', () => {
      const { container } = renderRow()

      expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    })

    it('says when it was queued, not when it was saved', () => {
      renderQueued({ state: 'waiting' })

      expect(
        screen.getByText('Public · Queued 12 minutes ago')
      ).toBeInTheDocument()
      expect(screen.queryByText(/Saved/)).toBeNull()
    })

    it('shows the reason under the chip', () => {
      renderQueued({
        state: 'needs_review',
        reason: 'Waited more than 24 hours.'
      })

      expect(screen.getByText('Waited more than 24 hours.')).toBeInTheDocument()
    })

    it('has no reason line while waiting', () => {
      const { container } = renderQueued({ state: 'waiting' })

      expect(container.querySelectorAll('p.text-sm')).toHaveLength(1)
    })

    it.each([
      ['waiting', {}, ['Edit', 'Copy']],
      ['sending', {}, ['Copy']],
      ['checking', {}, ['Copy']],
      ['needs_review', {}, ['Review', 'Copy', 'Delete']],
      ['couldnt_send', {}, ['Review', 'Copy', 'Delete']],
      ['paused', { pausedBy: 'rate_limit' }, ['Review', 'Copy']],
      ['paused', { pausedBy: 'actor' }, ['Review', 'Copy']],
      ['paused', { pausedBy: 'auth' }, ['Review', 'Sign in', 'Copy']],
      ['paused', { pausedBy: 'user' }, ['Review', 'Resume', 'Copy']]
    ] as const)(
      'offers the right actions for %s %j',
      (state, extra, labels) => {
        renderQueued({ state, ...extra })

        expect(buttons().sort()).toEqual([...labels].sort())
      }
    )

    it('labels Edit as Review for every state but waiting, and both open the editor', () => {
      const onEdit = vi.fn()
      const { unmount } = renderQueued({ state: 'waiting' }, onEdit)
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      unmount()
      renderQueued({ state: 'needs_review' }, onEdit)
      fireEvent.click(screen.getByRole('button', { name: 'Review' }))

      expect(onEdit).toHaveBeenCalledTimes(2)
    })

    it('sends a paused-for-auth post to the sign-in page', () => {
      renderQueued({ state: 'paused', pausedBy: 'auth' })

      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
        'href',
        '/auth/signin'
      )
    })

    it('still deletes a post that needs review, through the confirm dialog', async () => {
      renderQueued({ state: 'couldnt_send' })

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', {
            name: 'Delete'
          })
        )
      })

      expect(deleteDraftAndOwnedMedia).toHaveBeenCalledTimes(1)
    })

    it('Resume lifts the user pause for this actor, tells the other views and asks for a drain', async () => {
      const draft = draftRecord({
        queue: queueState({ state: 'paused', pausedBy: 'user' })
      })
      render(
        <DraftRow
          draft={draft}
          currentTime={NOW}
          onEdit={vi.fn()}
          onConflict={vi.fn()}
          onDeleteError={onDeleteError}
        />
      )

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
      })

      expect(resumeQueue).toHaveBeenCalledWith({
        actorId: draft.actorId,
        pausedBy: ['user']
      })
      expect(announceDraftsChanged).toHaveBeenCalledWith(
        'account-1',
        draft.actorId,
        'draft-1'
      )
      expect(requestDrain).toHaveBeenCalledTimes(1)
    })

    it('reports a failed Resume to the list and asks for no drain', async () => {
      vi.mocked(resumeQueue).mockRejectedValue(new Error('no db'))
      renderQueued({ state: 'paused', pausedBy: 'user' })

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
      })

      expect(onActionError).toHaveBeenCalledWith(
        'Something went wrong on this device. Try again.'
      )
      expect(requestDrain).not.toHaveBeenCalled()
      expect(announceDraftsChanged).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
    })
  })
})
