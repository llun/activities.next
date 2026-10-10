/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import type { Attachment } from '@/lib/types/domain/attachment'
import { urlToId } from '@/lib/utils/urlToId'

import { OwnPostMediasModal } from './own-post-medias-modal'

const OWNER = 'https://activities.local/users/llun'
const STATUS = `${OWNER}/statuses/post-1`

vi.mock('@/lib/components/medias-modal/medias-modal', () => ({
  MediasModal: ({
    medias,
    onEdit,
    canEdit,
    onClosed
  }: {
    medias: Attachment[] | null
    onEdit?: (index: number) => void
    canEdit?: (media: Attachment) => boolean
    onClosed: () => void
  }) =>
    medias ? (
      <div role="dialog" aria-label="Media viewer">
        {medias.map((media, index) => (
          <div key={media.id}>
            <span data-testid={`alt-${media.id}`}>{media.name}</span>
            {onEdit && (canEdit ? canEdit(media) : true) ? (
              <button onClick={() => onEdit(index)}>Edit {media.id}</button>
            ) : null}
          </div>
        ))}
        <button onClick={onClosed}>Close viewer</button>
      </div>
    ) : null
}))

const editor = vi.hoisted(() => ({
  current: null as null | {
    items: GalleryItemEntity[]
    initialMediaId: string
    ownerId: string
    onClose: () => void
    onSaved: (items: GalleryItemEntity[]) => void
  }
}))

vi.mock('@/lib/components/gallery/GalleryEditDetailsDialog', () => ({
  GalleryEditDetailsDialog: (props: NonNullable<typeof editor.current>) => {
    editor.current = props
    return <div role="dialog" aria-label="Edit details" />
  }
}))

const attachment = (
  id: string,
  overrides: Partial<Attachment> = {}
): Attachment => ({
  id,
  actorId: OWNER,
  statusId: STATUS,
  type: 'Document',
  mediaType: 'image/jpeg',
  url: `https://activities.local/media/${id}.jpg`,
  mediaId: `media-${id}`,
  name: `Alt ${id}`,
  createdAt: 1,
  updatedAt: 1,
  ...overrides
})

const renderModal = (
  medias: Attachment[],
  albumsOwnerId: string | null = OWNER,
  onClosed = vi.fn(),
  onAltTextSaved?: () => void
) => {
  const ui = (list: Attachment[]) => (
    <OwnPostMediasModal
      medias={list}
      initialSelection={0}
      albumsOwnerId={albumsOwnerId}
      onClosed={onClosed}
      onAltTextSaved={onAltTextSaved}
    />
  )
  const view = render(ui(medias))
  return { rerenderWith: (list: Attachment[]) => view.rerender(ui(list)) }
}

describe('OwnPostMediasModal', () => {
  beforeEach(() => {
    editor.current = null
  })

  it('offers Edit on the signed-in actor`s own photos and opens the editor for the one on screen', () => {
    renderModal([attachment('1'), attachment('2')])

    fireEvent.click(screen.getByRole('button', { name: 'Edit 2' }))

    expect(screen.getByRole('dialog', { name: 'Edit details' })).toBeVisible()
    expect(editor.current?.ownerId).toBe(OWNER)
    expect(editor.current?.initialMediaId).toBe('media-2')
    expect(editor.current?.items).toHaveLength(1)
    expect(editor.current?.items[0]).toEqual(
      expect.objectContaining({
        mediaId: 'media-2',
        statusId: urlToId(STATUS)
      })
    )
  })

  it('has no Edit when the viewer did not write the post', () => {
    renderModal([attachment('1')], null)

    expect(
      screen.queryByRole('button', { name: /^Edit/ })
    ).not.toBeInTheDocument()
  })

  it('has no Edit for a photo that is not the signed-in actor`s', () => {
    renderModal([
      attachment('1'),
      attachment('2', { actorId: 'https://remote.example/users/bob' })
    ])

    expect(screen.getByRole('button', { name: 'Edit 1' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit 2' })
    ).not.toBeInTheDocument()
  })

  it('shows the saved alt text in the viewer and keeps it when opened again', async () => {
    const onClosed = vi.fn()
    const { rerenderWith } = renderModal([attachment('1')], OWNER, onClosed)
    fireEvent.click(screen.getByRole('button', { name: 'Edit 1' }))

    act(() =>
      editor.current?.onSaved([
        {
          ...editor.current.items[0],
          attachment: { ...attachment('1'), name: 'A new description' }
        }
      ])
    )

    expect(screen.getByTestId('alt-1')).toHaveTextContent('A new description')
    act(() => editor.current?.onClose())
    expect(
      screen.queryByRole('dialog', { name: 'Edit details' })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))
    expect(onClosed).toHaveBeenCalledTimes(1)
    rerenderWith([attachment('1')])
    expect(screen.getByTestId('alt-1')).toHaveTextContent('A new description')
  })

  it('stops showing a saved alt text once the post says something else', () => {
    const { rerenderWith } = renderModal([attachment('1', { name: 'Old' })])
    fireEvent.click(screen.getByRole('button', { name: 'Edit 1' }))
    act(() =>
      editor.current?.onSaved([
        {
          ...editor.current.items[0],
          attachment: { ...attachment('1'), name: 'A' }
        }
      ])
    )
    expect(screen.getByTestId('alt-1')).toHaveTextContent('A')

    // The post was edited elsewhere (the inline composer) and refreshed.
    rerenderWith([attachment('1', { name: 'B' })])
    expect(screen.getByTestId('alt-1')).toHaveTextContent('B')
  })

  it('tells the page a save happened so it can refresh the post', () => {
    const onAltTextSaved = vi.fn()
    renderModal([attachment('1')], OWNER, vi.fn(), onAltTextSaved)
    fireEvent.click(screen.getByRole('button', { name: 'Edit 1' }))

    act(() =>
      editor.current?.onSaved([
        {
          ...editor.current.items[0],
          attachment: { ...attachment('1'), name: 'New' }
        }
      ])
    )

    expect(onAltTextSaved).toHaveBeenCalledTimes(1)
  })

  it('closes the editor with the viewer', () => {
    renderModal([attachment('1')])
    fireEvent.click(screen.getByRole('button', { name: 'Edit 1' }))

    fireEvent.click(screen.getByRole('button', { name: 'Close viewer' }))

    expect(
      screen.queryByRole('dialog', { name: 'Edit details' })
    ).not.toBeInTheDocument()
  })
})
