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
import { IDBFactory } from 'fake-indexeddb'

import {
  DraftConflictError,
  type DraftRecord,
  deleteDraft,
  deleteDraftAndOwnedMedia,
  getDraft,
  postDraftsMessage,
  resetDraftsChannelForTesting,
  resetDraftsDbForTesting,
  saveDraft,
  setDraftsIndexedDBFactory
} from '@/lib/client/drafts'
import { installFakeBroadcastChannel } from '@/lib/testing/fakeBroadcastChannel'

import { DraftsList } from './DraftsList'
import { ACTOR_ID, NOW, draftRecord, profile } from './draftFixtures.testUtils'

vi.mock('@/lib/client/media', () => ({ deleteUnpostedMedia: vi.fn() }))
vi.mock('@/lib/client/fitnessRoutes', () => ({
  deleteFitnessFile: vi.fn(),
  deleteUnpostedFitnessFile: vi.fn()
}))
// The real helper, replaceable per test to force a conflict.
vi.mock('@/lib/client/drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client/drafts')>()
  return {
    ...actual,
    deleteDraftAndOwnedMedia: vi.fn(actual.deleteDraftAndOwnedMedia)
  }
})
vi.mock('./DraftEditor', () => ({
  DraftEditor: ({
    draft,
    onClose
  }: {
    draft: DraftRecord
    onClose: () => void
  }) => (
    <div data-testid="editor">
      editing {draft.id}
      <button onClick={onClose}>Close</button>
    </div>
  )
}))

const seed = (patch: Partial<DraftRecord>) =>
  saveDraft(draftRecord({ revision: 0, ...patch }), {
    expectedRevision: 0,
    epoch: 0
  })

const renderList = () =>
  render(<DraftsList host="llun.test" profile={profile} currentTime={NOW} />)

const rowTexts = () =>
  [...document.querySelectorAll('[data-slot="draft-row"]')].map(
    (row) => row.querySelector('p.line-clamp-3')?.textContent
  )

describe('DraftsList', () => {
  beforeEach(() => {
    // Only Date: fake timers of any other kind stall fake-indexeddb.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    installFakeBroadcastChannel()
    setDraftsIndexedDBFactory(new IDBFactory())
  })

  afterEach(() => {
    resetDraftsChannelForTesting()
    setDraftsIndexedDBFactory(null)
    resetDraftsDbForTesting()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows "No drafts." when this actor has none', async () => {
    await seed({ id: 'other', actorId: 'https://llun.test/users/other' })
    renderList()

    expect(
      await screen.findByRole('heading', { name: 'No drafts.' })
    ).toBeInTheDocument()
    expect(
      screen.getByText("Posts you save or can't send yet appear here.")
    ).toBeInTheDocument()
    expect(screen.queryByText('Drafts on this device')).not.toBeInTheDocument()
  })

  it('announces one polite Loading while it reads', () => {
    renderList()

    expect(screen.getByRole('status')).toHaveTextContent('Loading drafts')
  })

  it("lists only this actor's drafts, newest first, under a count", async () => {
    await seed({ id: 'old', text: 'older', updatedAt: NOW - 60_000 })
    await seed({ id: 'new', text: 'newer', updatedAt: NOW - 1_000 })
    await seed({
      id: 'other',
      text: 'not mine',
      actorId: 'https://llun.test/users/other'
    })
    renderList()

    expect(
      await screen.findByRole('heading', { name: 'Drafts on this device' })
    ).toBeInTheDocument()
    expect(screen.getByText('2 drafts')).toBeInTheDocument()
    expect(rowTexts()).toEqual(['newer', 'older'])
    expect(screen.queryByText('not mine')).not.toBeInTheDocument()
  })

  it('draws an Alert, outside any list, when storage is unavailable, and Retry reads again', async () => {
    await seed({ id: 'a', text: 'saved earlier' })
    setDraftsIndexedDBFactory(null)
    renderList()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't open drafts on this device")
    expect(alert.closest('[data-slot="frame"]')).toBeNull()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    // The seeded database comes back.
    const restored = new IDBFactory()
    setDraftsIndexedDBFactory(restored)
    await seed({ id: 'a', text: 'saved earlier' })
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('saved earlier')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it("re-reads when this actor's drafts change in another tab", async () => {
    renderList()
    await screen.findByRole('heading', { name: 'No drafts.' })

    await seed({ id: 'late', text: 'written elsewhere' })
    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'account-1',
        actorId: ACTOR_ID,
        draftId: 'late'
      })
    })

    expect(await screen.findByText('written elsewhere')).toBeInTheDocument()
  })

  it("ignores another actor's changes", async () => {
    renderList()
    await screen.findByRole('heading', { name: 'No drafts.' })

    await seed({ id: 'late', text: 'written elsewhere' })
    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'account-1',
        actorId: 'https://llun.test/users/other',
        draftId: 'late'
      })
    })
    // Let any (wrongly) started read settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(screen.queryByText('written elsewhere')).not.toBeInTheDocument()
  })

  it('re-reads when the tab becomes visible again', async () => {
    renderList()
    await screen.findByRole('heading', { name: 'No drafts.' })

    await seed({ id: 'late', text: 'written while hidden' })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(await screen.findByText('written while hidden')).toBeInTheDocument()
  })

  it('deletes a confirmed draft from the database and the page', async () => {
    await seed({ id: 'keep', text: 'keep me', updatedAt: NOW - 2_000 })
    await seed({ id: 'drop', text: 'drop me', updatedAt: NOW - 1_000 })
    renderList()
    await screen.findByText('drop me')

    const row = screen.getByText('drop me').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )
    })

    await waitFor(() =>
      expect(screen.queryByText('drop me')).not.toBeInTheDocument()
    )
    expect(screen.getByText('keep me')).toBeInTheDocument()
    expect(await getDraft('drop')).toBeUndefined()
    expect(await getDraft('keep')).toBeDefined()
  })

  it('swaps a row for the editor on Edit and back on close', async () => {
    await seed({ id: 'a', text: 'first', updatedAt: NOW - 1_000 })
    await seed({ id: 'b', text: 'second', updatedAt: NOW - 2_000 })
    renderList()
    await screen.findByText('first')

    const row = screen.getByText('first').closest('li') as HTMLElement
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    expect(screen.getByTestId('editor')).toHaveTextContent('editing a')
    expect(screen.queryByText('first')).not.toBeInTheDocument()
    // The other row is untouched.
    expect(screen.getByText('second')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('first')).toBeInTheDocument()
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
  })

  it('closes the editor when its draft disappears, leaving the others', async () => {
    await seed({ id: 'a', text: 'first', updatedAt: NOW - 1_000 })
    await seed({ id: 'b', text: 'second', updatedAt: NOW - 2_000 })
    renderList()
    await screen.findByText('first')
    fireEvent.click(
      within(screen.getByText('first').closest('li') as HTMLElement).getByRole(
        'button',
        { name: 'Edit' }
      )
    )
    expect(screen.getByTestId('editor')).toBeInTheDocument()

    await deleteDraft('a')
    await act(async () => {
      postDraftsMessage({
        type: 'changed',
        accountId: 'account-1',
        actorId: ACTOR_ID,
        draftId: 'a'
      })
    })

    expect(await screen.findByText('second')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByTestId('editor')).not.toBeInTheDocument()
    )
  })

  it('shows a failed delete as an Alert above the list, whose Retry deletes and clears it', async () => {
    await seed({ id: 'a', text: 'drop me' })
    renderList()
    await screen.findByText('drop me')
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValueOnce(
      new Error('storage failed')
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't delete draft")
    // Above the box, never inside it.
    expect(alert.closest('ul')).toBeNull()
    expect(
      alert.compareDocumentPosition(screen.getByRole('list')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(await getDraft('a')).toBeDefined()

    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    })

    await waitFor(async () => expect(await getDraft('a')).toBeUndefined())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it("keeps a row's delete error through another row's delete, and its Retry never deletes a save made since", async () => {
    await seed({ id: 'a', text: 'drop me', updatedAt: NOW - 2 })
    await seed({ id: 'b', text: 'and me', updatedAt: NOW - 1 })
    renderList()
    await screen.findByText('drop me')
    const deleteRow = async (text: string) => {
      const row = screen.getByText(text).closest('[data-slot="draft-row"]')
      fireEvent.click(
        within(row as HTMLElement).getByRole('button', { name: 'Delete' })
      )
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', {
            name: 'Delete'
          })
        )
      })
    }
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValueOnce(
      new Error('storage failed')
    )

    await deleteRow('drop me')
    const alert = await screen.findByRole('alert')
    await deleteRow('and me')
    await waitFor(() => expect(screen.queryByText('and me')).toBeNull())
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('Something went wrong')

    // The draft is edited after the failure (the editor, or another tab), and
    // the list re-reads it.
    await saveDraft(draftRecord({ id: 'a', text: 'drop me, edited' }), {
      expectedRevision: 1,
      epoch: 0
    })
    act(() =>
      postDraftsMessage({
        type: 'changed',
        accountId: 'account-1',
        actorId: ACTOR_ID,
        draftId: 'a'
      })
    )
    expect(await screen.findByText('drop me, edited')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    })

    expect(
      await screen.findByText(/This draft was changed/)
    ).toBeInTheDocument()
    expect((await getDraft('a'))?.text).toBe('drop me, edited')
  })

  it('clears a failed delete when Retry finds the draft already gone', async () => {
    await seed({ id: 'a', text: 'drop me' })
    renderList()
    await screen.findByText('drop me')
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValueOnce(
      new Error('storage failed')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete'
        })
      )
    })
    const alert = await screen.findByRole('alert')
    await deleteDraft('a')

    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    })

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('on a delete conflict shows the newest save and lets Delete be retried', async () => {
    await seed({ id: 'a', text: 'before' })
    renderList()
    await screen.findByText('before')

    // Another tab saves first, then this tab's delete is refused.
    await saveDraft(draftRecord({ id: 'a', text: 'after' }), {
      expectedRevision: 1,
      epoch: 0
    })
    vi.mocked(deleteDraftAndOwnedMedia).mockRejectedValueOnce(
      new DraftConflictError()
    )
    const confirmDelete = async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', {
            name: 'Delete'
          })
        )
      })
    }

    await confirmDelete()
    expect(await screen.findByText('after')).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent("Couldn't delete draft")
    expect(alert).toHaveTextContent('This draft was changed')
    expect(alert.closest('li')).toBeNull()
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(await getDraft('a')).toBeDefined()

    await confirmDelete()
    await waitFor(async () => expect(await getDraft('a')).toBeUndefined())
    expect(
      await screen.findByRole('heading', { name: 'No drafts.' })
    ).toBeInTheDocument()
  })
})
