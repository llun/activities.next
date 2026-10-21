/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import {
  DraftConflictError,
  deleteDraftAndOwnedMedia,
  getDraftBlob,
  postDraftsMessage
} from '@/lib/client/drafts'

import { DraftRow } from './DraftRow'
import { NOW, draftRecord, targetStatus } from './draftFixtures.testUtils'

vi.mock('@/lib/client/drafts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client/drafts')>()),
  deleteDraftAndOwnedMedia: vi.fn(),
  getDraftBlob: vi.fn(),
  postDraftsMessage: vi.fn()
}))

const writeText = vi.fn()

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
    />
  )

describe('DraftRow', () => {
  beforeEach(() => {
    vi.mocked(deleteDraftAndOwnedMedia).mockResolvedValue(undefined)
    vi.mocked(getDraftBlob).mockResolvedValue(undefined)
    writeText.mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
  })

  afterEach(() => {
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
    expect(postDraftsMessage).not.toHaveBeenCalled()
  })

  it('deletes the draft and its owned media, then tells the other views', async () => {
    const draft = draftRecord()
    render(
      <DraftRow
        draft={draft}
        currentTime={NOW}
        onEdit={vi.fn()}
        onConflict={vi.fn()}
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
    expect(postDraftsMessage).toHaveBeenCalledWith({
      type: 'changed',
      accountId: 'account-1',
      actorId: draft.actorId,
      draftId: 'draft-1'
    })
  })

  it('says so when the delete fails, and announces nothing', async () => {
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

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't delete this draft"
    )
    expect(postDraftsMessage).not.toHaveBeenCalled()
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
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This draft changed in another tab'
    )
    expect(postDraftsMessage).not.toHaveBeenCalled()
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
})
