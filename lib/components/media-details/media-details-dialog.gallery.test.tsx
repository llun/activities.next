/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor } from '@testing-library/react'

import { updateMediaDetails, updateNote } from '@/lib/client'

import {
  emptyDetails,
  gears,
  getGalleryGearsMock,
  getMediaMock,
  makeItem,
  renderDialog,
  updateMediaDetailsMock
} from './media-details-dialog.helpers'

vi.mock('@/lib/client', () => ({
  addGalleryAlbumItems: vi.fn(),
  getMediaAlbums: vi.fn(),
  removeGalleryAlbumItems: vi.fn(),
  createGalleryGear: vi.fn(),
  describeMedia: vi.fn(),
  getGalleryGears: vi.fn(),
  getMedia: vi.fn(),
  retryMediaLookups: vi.fn(),
  searchGalleryTaxa: vi.fn(),
  suggestMediaSubjects: vi.fn(),
  updateMediaDetails: vi.fn(),
  updateNote: vi.fn(),
  TaxaSearchUnavailableError: class extends Error {}
}))

const updateNoteMock = vi.mocked(updateNote)

const POST = {
  statusId: 'status-1',
  href: '/@llun@activities.local/status-1'
}

const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))

describe('MediaDetailsDialog in the gallery', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    getGalleryGearsMock.mockResolvedValue(gears)
    getMediaMock.mockImplementation(() => new Promise(() => {}))
    updateMediaDetailsMock.mockImplementation(
      async (id, fields) =>
        ({
          id,
          description:
            (fields.description as string | null | undefined) ?? null,
          details: { ...emptyDetails, inGallery: fields.in_gallery === true }
        }) as unknown as Awaited<ReturnType<typeof updateMediaDetails>>
    )
    updateNoteMock.mockResolvedValue(
      {} as Awaited<ReturnType<typeof updateNote>>
    )
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver
  })

  it('is titled Edit details and hides the counter for one item', () => {
    renderDialog([makeItem('a', { post: POST })], { context: 'gallery' })

    expect(
      screen.getByRole('dialog', { name: 'Edit details' })
    ).toBeInTheDocument()
    expect(screen.queryByText('1 of 1')).not.toBeInTheDocument()
  })

  it('keeps the counter when several items are edited', () => {
    renderDialog(
      [makeItem('a', { post: POST }), makeItem('b', { post: POST })],
      {
        context: 'gallery'
      }
    )

    expect(screen.getByText('1 of 2')).toBeInTheDocument()
  })

  it('keeps the composer title and counter by default', () => {
    renderDialog([makeItem('a')])

    expect(
      screen.getByRole('dialog', { name: 'Media details' })
    ).toBeInTheDocument()
    expect(screen.getByText('1 of 1')).toBeInTheDocument()
  })

  it('explains that alt text edits the post and links to it', () => {
    renderDialog([makeItem('a', { post: POST })], { context: 'gallery' })

    expect(
      screen.getByText(
        'Changing alt text edits the post, like Mastodon. Followers see it as edited.'
      )
    ).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Open post/ })
    expect(link).toHaveAttribute('href', POST.href)
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows neither the note nor the link for an item without a post', () => {
    renderDialog([makeItem('a')])

    expect(screen.queryByText(/edits the post/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Open post/ })
    ).not.toBeInTheDocument()
  })

  it('hides the link when the post page is unknown', () => {
    renderDialog(
      [makeItem('a', { post: { statusId: 'status-1', href: null } })],
      { context: 'gallery' }
    )

    expect(
      screen.queryByRole('link', { name: /Open post/ })
    ).not.toBeInTheDocument()
    expect(screen.getByText(/edits the post/)).toBeInTheDocument()
  })

  it('saves details through the media and alt text through the post', async () => {
    const { onSaved, onClose } = renderDialog([makeItem('a', { post: POST })], {
      context: 'gallery'
    })

    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'A heron at dawn' }
    })
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Grey heron' }
    })
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledTimes(1)
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      subject_name: 'Grey heron'
    })
    expect(updateNoteMock).toHaveBeenCalledWith({
      statusId: 'status-1',
      mediaAttributes: [{ id: 'a', description: 'A heron at dawn' }]
    })
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', description: 'A heron at dawn' })
    ])
  })

  it('does not touch the post when only other details change', async () => {
    const { onClose } = renderDialog([makeItem('a', { post: POST })], {
      context: 'gallery'
    })

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Grey heron' }
    })
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      subject_name: 'Grey heron'
    })
    expect(updateNoteMock).not.toHaveBeenCalled()
  })

  it('edits only the post when only the alt text changes', async () => {
    const { onSaved, onClose } = renderDialog([makeItem('a', { post: POST })], {
      context: 'gallery'
    })

    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'New alt' }
    })
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()
    expect(updateNoteMock).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', description: 'New alt' })
    ])
  })

  it('keeps saving the alt text through the media for an unposted item', async () => {
    const { onClose } = renderDialog([makeItem('a')])

    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'New alt' }
    })
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      description: 'New alt'
    })
    expect(updateNoteMock).not.toHaveBeenCalled()
  })

  it('reports the details that saved when the post edit fails', async () => {
    updateNoteMock.mockRejectedValue(new Error('Post could not be edited'))
    const { onSaved, onClose } = renderDialog(
      [makeItem('a', { post: POST, description: 'Old alt' })],
      { context: 'gallery' }
    )

    fireEvent.change(screen.getByLabelText('Description (alt text)'), {
      target: { value: 'New alt' }
    })
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Grey heron' }
    })
    save()

    expect(
      await screen.findByText(/Post could not be edited/)
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', description: 'Old alt' })
    ])
  })
  it('labels the decorative option for the post it clears', () => {
    renderDialog([makeItem('a', { post: POST })], { context: 'gallery' })

    expect(
      screen.getByLabelText('Decorative image, no description')
    ).toBeInTheDocument()
  })

  it('sends one post edit for several photos of the same post', async () => {
    const { onSaved, onClose } = renderDialog(
      [
        makeItem('a', { post: POST }),
        makeItem('b', { post: POST }),
        makeItem('c', { post: { statusId: 'status-2', href: null } })
      ],
      { context: 'gallery' }
    )

    const edit = (alt: string) =>
      fireEvent.change(screen.getByLabelText('Description (alt text)'), {
        target: { value: alt }
      })
    const goTo = (name: string) =>
      fireEvent.click(screen.getByRole('button', { name }))
    edit('First')
    goTo('Next item')
    edit('Second')
    goTo('Next item')
    edit('Third')
    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()
    expect(updateNoteMock).toHaveBeenCalledTimes(2)
    expect(updateNoteMock).toHaveBeenCalledWith({
      statusId: 'status-1',
      mediaAttributes: [
        { id: 'a', description: 'First' },
        { id: 'b', description: 'Second' }
      ]
    })
    expect(updateNoteMock).toHaveBeenCalledWith({
      statusId: 'status-2',
      mediaAttributes: [{ id: 'c', description: 'Third' }]
    })
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a', description: 'First' }),
      expect.objectContaining({ id: 'b', description: 'Second' }),
      expect.objectContaining({ id: 'c', description: 'Third' })
    ])
  })

  it('names every photo of a post whose edit failed and still saves the others', async () => {
    updateNoteMock.mockImplementation(async ({ statusId }) => {
      if (statusId === 'status-1') throw new Error('Post could not be edited')
      return {} as Awaited<ReturnType<typeof updateNote>>
    })
    const { onSaved, onClose } = renderDialog(
      [
        makeItem('a', { post: POST }),
        makeItem('b', { post: POST }),
        makeItem('c', { post: { statusId: 'status-2', href: null } })
      ],
      { context: 'gallery' }
    )

    const edit = (alt: string) =>
      fireEvent.change(screen.getByLabelText('Description (alt text)'), {
        target: { value: alt }
      })
    const goTo = (name: string) =>
      fireEvent.click(screen.getByRole('button', { name }))
    edit('First')
    goTo('Next item')
    edit('Second')
    goTo('Next item')
    edit('Third')
    save()

    expect(
      await screen.findByText(
        /Could not save item 1, item 2: Post could not be edited/
      )
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'c', description: 'Third' })
    ])
  })
  describe('a photo added in Gallery and not posted yet', () => {
    const unposted = (id: string) => makeItem(id, { unposted: true })

    it('offers Post… and Delete instead of a link to a post', () => {
      renderDialog([unposted('a')], {
        context: 'gallery',
        onPostItem: vi.fn(),
        onDeleteItem: vi.fn()
      })

      expect(screen.getByRole('button', { name: 'Post…' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible()
      expect(screen.queryByText('Open post')).not.toBeInTheDocument()
      // No post to edit, so no note about editing one.
      expect(
        screen.queryByText(/Changing alt text edits the post/)
      ).not.toBeInTheDocument()
    })

    it('offers nothing for a posted photo, or when the page does not handle them', () => {
      const { unmount } = renderDialog([makeItem('a', { post: POST })], {
        context: 'gallery',
        onPostItem: vi.fn(),
        onDeleteItem: vi.fn()
      })
      expect(
        screen.queryByRole('button', { name: 'Post…' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Delete' })
      ).not.toBeInTheDocument()
      unmount()

      renderDialog([unposted('a')], { context: 'gallery' })
      expect(
        screen.queryByRole('button', { name: 'Post…' })
      ).not.toBeInTheDocument()
    })

    it('saves the details first, then hands the photo over to post', async () => {
      const onPostItem = vi.fn()
      const { onClose, onSaved } = renderDialog([unposted('a')], {
        context: 'gallery',
        onPostItem
      })
      fireEvent.change(screen.getByLabelText('Description (alt text)'), {
        target: { value: 'A heron' }
      })

      fireEvent.click(screen.getByRole('button', { name: 'Post…' }))

      await waitFor(() => expect(onPostItem).toHaveBeenCalledWith('a'))
      // The alt text went to the media itself, where the composer reads it.
      expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
        description: 'A heron'
      })
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(updateNoteMock).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('stays when the details could not be saved', async () => {
      updateMediaDetailsMock.mockRejectedValue(new Error('Disk full'))
      const onPostItem = vi.fn()
      renderDialog([unposted('a')], { context: 'gallery', onPostItem })
      fireEvent.change(screen.getByLabelText('Description (alt text)'), {
        target: { value: 'A heron' }
      })

      fireEvent.click(screen.getByRole('button', { name: 'Post…' }))

      expect(await screen.findByText(/Disk full/)).toBeVisible()
      expect(onPostItem).not.toHaveBeenCalled()
    })

    it('hands the photo to the page to delete', () => {
      const onDeleteItem = vi.fn()
      renderDialog([unposted('a'), unposted('b')], {
        context: 'gallery',
        onDeleteItem,
        initialId: 'b'
      })

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

      expect(onDeleteItem).toHaveBeenCalledWith('b')
    })
  })
})
