/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { deleteAccountMedia, updateNote } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { PostBox } from './post-box'
import {
  attach,
  getGallerySettingsMock,
  getMediaMock,
  mediaEntity,
  profile,
  resetPostBoxMediaMocks,
  settings,
  updateMediaDetailsMock
} from './post-box-media.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  createPoll: vi.fn(),
  deleteFitnessFile: vi.fn(),
  describeMedia: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGalleryGears: vi.fn(),
  getGallerySettings: vi.fn(),
  getMedia: vi.fn(),
  getMediaAlbums: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/extractVideoPoster', () => ({
  extractVideoPoster: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

describe('PostBox media details', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    resetPostBoxMediaMocks()
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('sends edited descriptions as media_attributes when updating a status', async () => {
    vi.mocked(updateNote).mockResolvedValue({
      content: '',
      spoilerText: '',
      mediaAttachments: [],
      status: { id: 'status-1', text: 'hello', createdAt: 1, reply: '' }
    } as never)
    getMediaMock.mockImplementation(async (id) => mediaEntity(id, 'old alt'))
    const editStatus = {
      id: 'status-1',
      actorId: profile.id,
      actor: profile,
      to: [],
      cc: [],
      edits: [],
      isLocalActor: true,
      createdAt: 1,
      updatedAt: 1,
      type: 'Note',
      url: 'https://activities.local/@llun/status-1',
      text: 'hello',
      summary: null,
      reply: '',
      replies: [],
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      attachments: [
        {
          id: 'att-1',
          actorId: profile.id,
          statusId: 'status-1',
          type: 'Document',
          mediaType: 'image/png',
          url: 'https://activities.local/api/v1/files/a.png',
          width: 10,
          height: 10,
          name: 'old alt',
          createdAt: 1,
          updatedAt: 1,
          mediaId: 'media-1'
        }
      ],
      tags: []
    } as never
    render(
      <PostBox
        host="activities.local"
        profile={profile}
        editStatus={editStatus}
        isMediaUploadEnabled
        onDiscardReply={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled()

    fireEvent.click(await screen.findByRole('button', { name: /details of/ }))
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'new alt' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    await waitFor(() =>
      expect(vi.mocked(updateNote)).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaAttributes: [{ id: 'media-1', description: 'new alt' }]
        })
      )
    )
  })

  describe('editing a status with existing media', () => {
    const makeEditStatus = () =>
      ({
        id: 'status-1',
        actorId: profile.id,
        actor: profile,
        to: [],
        cc: [],
        edits: [],
        isLocalActor: true,
        createdAt: 1,
        updatedAt: 1,
        type: 'Note',
        url: 'https://activities.local/@llun/status-1',
        text: 'hello',
        summary: null,
        reply: '',
        replies: [],
        actorAnnounceStatusId: null,
        isActorLiked: false,
        isActorBookmarked: false,
        totalLikes: 0,
        totalShares: 0,
        attachments: [
          {
            id: 'att-1',
            actorId: profile.id,
            statusId: 'status-1',
            type: 'Document',
            mediaType: 'image/png',
            url: 'https://activities.local/api/v1/files/a.png',
            width: 10,
            height: 10,
            name: '',
            createdAt: 1,
            updatedAt: 1,
            mediaId: 'media-1'
          }
        ],
        tags: []
      }) as never

    const renderEdit = () =>
      render(
        <PostBox
          host="activities.local"
          profile={profile}
          editStatus={makeEditStatus()}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      )

    it('keeps the attachment name when the dialog closes without saving', async () => {
      const edit = makeEditStatus() as unknown as {
        attachments: { name: string }[]
      }
      edit.attachments[0].name = 'Foo'
      getMediaMock.mockResolvedValue(mediaEntity('media-1', null))
      vi.mocked(updateNote).mockResolvedValue({
        content: '',
        spoilerText: '',
        mediaAttachments: [],
        status: { id: 'status-1', text: 'hello', createdAt: 1, reply: '' }
      } as never)
      render(
        <PostBox
          host="activities.local"
          profile={profile}
          editStatus={edit as never}
          isMediaUploadEnabled
          onDiscardReply={vi.fn()}
          onPostCreated={vi.fn()}
          onPostUpdated={vi.fn()}
          onDiscardEdit={vi.fn()}
        />
      )
      fireEvent.change(await screen.findByRole('textbox'), {
        target: { value: 'hello there' }
      })

      fireEvent.click(await screen.findByRole('button', { name: /details of/ }))
      await screen.findByRole('dialog')
      await waitFor(() => expect(getMediaMock).toHaveBeenCalled())
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      fireEvent.click(screen.getByRole('button', { name: 'Update' }))

      await waitFor(() => expect(vi.mocked(updateNote)).toHaveBeenCalled())
      const sent = vi.mocked(updateNote).mock.calls[0][0] as {
        mediaAttributes?: unknown[]
      }
      expect(sent.mediaAttributes ?? []).toEqual([])
      expect(edit.attachments[0].name).toBe('Foo')
    })

    it('keeps Update disabled when details finish saving mid-submit', async () => {
      const save = createDeferred<ReturnType<typeof mediaEntity>>()
      updateMediaDetailsMock.mockReturnValueOnce(save.promise as never)
      const update = createDeferred<Awaited<ReturnType<typeof updateNote>>>()
      vi.mocked(updateNote).mockReturnValueOnce(update.promise)
      renderEdit()
      fireEvent.change(await screen.findByRole('textbox'), {
        target: { value: 'hello there' }
      })
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      )

      fireEvent.click(screen.getByRole('button', { name: /details of/ }))
      await screen.findByRole('dialog')
      fireEvent.change(screen.getByLabelText('Description (alt text)'), {
        target: { value: 'new alt' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
      await waitFor(() => expect(updateMediaDetailsMock).toHaveBeenCalled())
      // Update is sent while the details save is still pending.
      fireEvent.click(
        screen.getByRole('button', { name: 'Update', hidden: true })
      )
      await waitFor(() => expect(vi.mocked(updateNote)).toHaveBeenCalled())

      save.resolve(mediaEntity('media-existing', 'new alt'))
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      )
      expect(
        screen.getByRole('button', { name: 'Update', hidden: true })
      ).toBeDisabled()

      update.resolve({
        content: '',
        spoilerText: '',
        mediaAttachments: [],
        status: { id: 'status-1', text: 'hello', createdAt: 1, reply: '' }
      } as never)
    })

    it('does not require a description for legacy undescribed media', async () => {
      getGallerySettingsMock.mockResolvedValue(
        settings({ allowEmptyDescription: false })
      )
      renderEdit()
      await waitFor(() => expect(getGallerySettingsMock).toHaveBeenCalled())
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'hello there' }
      })

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      )
      expect(
        screen.queryByText(
          'Add a description to every item, or mark it decorative'
        )
      ).not.toBeInTheDocument()
    })

    it('still requires a description for media added during the edit', async () => {
      getGallerySettingsMock.mockResolvedValue(
        settings({ allowEmptyDescription: false })
      )
      renderEdit()
      attach('new.png')

      expect(
        await screen.findByText(
          'Add a description to every item, or mark it decorative'
        )
      ).toBeInTheDocument()
    })

    it('never deletes the original media when removed or unmounted', async () => {
      const { unmount } = renderEdit()
      fireEvent.click(
        await screen.findByRole('button', { name: /Remove media/ })
      )
      unmount()

      expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
    })

    it('does not delete media added during an edit when the parent unmounts the composer in onPostUpdated', async () => {
      vi.mocked(updateNote).mockResolvedValue({
        content: '',
        spoilerText: '',
        mediaAttachments: [],
        status: { id: 'status-1', text: 'hello', createdAt: 1, reply: '' }
      } as never)
      const Host = () => {
        const [open, setOpen] = useState(true)
        return open ? (
          <PostBox
            host="activities.local"
            profile={profile}
            editStatus={makeEditStatus()}
            isMediaUploadEnabled
            onDiscardReply={vi.fn()}
            onPostCreated={vi.fn()}
            onPostUpdated={() => setOpen(false)}
            onDiscardEdit={vi.fn()}
          />
        ) : (
          <div>closed</div>
        )
      }
      render(<Host />)
      attach('new.png')
      await screen.findByRole('button', { name: 'Remove media new.png' })
      await waitFor(() => expect(getMediaMock).toHaveBeenCalled())
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled()
      )

      fireEvent.click(screen.getByRole('button', { name: 'Update' }))

      await screen.findByText('closed')
      expect(vi.mocked(updateNote)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(deleteAccountMedia)).not.toHaveBeenCalled()
    })

    it('deletes media uploaded during the edit when it is removed', async () => {
      renderEdit()
      attach('new.png')
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Remove media new.png' })
        ).toBeInTheDocument()
      )
      await waitFor(() => expect(getMediaMock).toHaveBeenCalled())
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove media new.png' })
      )

      expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(deleteAccountMedia)).toHaveBeenCalledWith({
        mediaId: 'media-new.png'
      })
    })
  })
})
