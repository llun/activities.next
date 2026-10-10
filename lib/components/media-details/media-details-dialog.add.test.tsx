/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'

import { updateMediaDetails } from '@/lib/client'

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

const uploading = (id: string) =>
  makeItem(id, { details: null, upload: { state: 'uploading' } })
const failed = (id: string, error = 'The server rejected the upload') =>
  makeItem(id, { details: null, upload: { state: 'failed', error } })

const addButton = (count: number) =>
  screen.getByRole('button', { name: `Add ${count} to gallery` })

describe('MediaDetailsDialog adding to the gallery', () => {
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
          details: { ...emptyDetails }
        }) as unknown as Awaited<ReturnType<typeof updateMediaDetails>>
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

  const onAdd = () => vi.fn().mockResolvedValue(undefined)

  it('is titled Add to gallery with the count and a note that only the owner sees them', () => {
    renderDialog([makeItem('a'), makeItem('b'), makeItem('c')], {
      context: 'add',
      onAdd: onAdd()
    })

    const dialog = screen.getByRole('dialog', { name: 'Add to gallery' })
    expect(within(dialog).getByText('3 photos')).toBeVisible()
    expect(
      within(dialog).getByText('Only you can see these until you post them')
    ).toBeVisible()
    expect(addButton(3)).toBeEnabled()
    // Adding puts them in the gallery, so there is no switch for it, and no
    // per-section "use for all" boxes: Apply to all does that.
    expect(
      within(dialog).queryByRole('switch', { name: 'Show in my gallery' })
    ).not.toBeInTheDocument()
    expect(
      within(dialog).queryByLabelText(/Use this gear for all/)
    ).not.toBeInTheDocument()
  })

  it('counts videos and mixed files', () => {
    renderDialog([makeItem('a', { mediaType: 'video/mp4' })], {
      context: 'add',
      onAdd: onAdd()
    })
    expect(screen.getByText('1 video')).toBeVisible()
  })

  it('shows each file’s upload in the strip and stops Add until they are done', () => {
    renderDialog([makeItem('a'), uploading('b'), failed('c')], {
      context: 'add',
      onAdd: onAdd()
    })

    const strip = screen.getByRole('list', { name: 'Items' })
    expect(
      within(strip).getByRole('button', { name: 'Item 2, uploading' })
    ).toBeVisible()
    expect(
      within(strip).getByRole('button', { name: 'Item 3, upload failed' })
    ).toBeVisible()
    // The count includes the file still going up, not the one that failed.
    expect(addButton(2)).toBeDisabled()
    expect(screen.getByText('1 file failed and is left out.')).toBeVisible()
  })

  it('shows an uploading file as uploading, without details to edit', () => {
    renderDialog([uploading('a'), makeItem('b')], {
      context: 'add',
      onAdd: onAdd()
    })

    expect(screen.getByTestId('upload-overlay')).toHaveTextContent('Uploading…')
    expect(
      screen.queryByRole('textbox', { name: 'Description (alt text)' })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('Apply to all')).not.toBeInTheDocument()
  })

  it('explains a failed file and removes it when asked', () => {
    const onRemoveItem = vi.fn()
    renderDialog([failed('a'), makeItem('b')], {
      context: 'add',
      onAdd: onAdd(),
      onRemoveItem
    })

    expect(
      screen.getByText(
        'This file could not be uploaded: The server rejected the upload'
      )
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Remove this file' }))
    expect(onRemoveItem).toHaveBeenCalledWith('a')
  })

  it('saves every photo’s details, then adds them, and closes', async () => {
    const add = onAdd()
    const { onClose, onSaved } = renderDialog(
      [makeItem('a'), makeItem('b'), failed('c')],
      { context: 'add', onAdd: add }
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Description (alt text)' }),
      { target: { value: 'A heron' } }
    )

    fireEvent.click(addButton(2))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(updateMediaDetailsMock).toHaveBeenCalledTimes(1)
    expect(updateMediaDetailsMock).toHaveBeenCalledWith('a', {
      description: 'A heron'
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
    // The failed file is left out.
    expect(add).toHaveBeenCalledWith(['a', 'b'])
  })

  it('adds photos nobody edited without saving anything', async () => {
    const add = onAdd()
    const { onClose } = renderDialog([makeItem('a')], {
      context: 'add',
      onAdd: add
    })

    fireEvent.click(addButton(1))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(updateMediaDetailsMock).not.toHaveBeenCalled()
    expect(add).toHaveBeenCalledWith(['a'])
  })

  it('stays open with the reason when saving a photo fails, and does not add', async () => {
    updateMediaDetailsMock.mockRejectedValue(new Error('Disk full'))
    const add = onAdd()
    const { onClose } = renderDialog([makeItem('a'), makeItem('b')], {
      context: 'add',
      onAdd: add
    })
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Description (alt text)' }),
      { target: { value: 'A heron' } }
    )

    fireEvent.click(addButton(2))

    expect(
      await screen.findByText(/Could not save this item: Disk full/)
    ).toBeVisible()
    expect(add).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open with the reason when adding fails, and does not save twice', async () => {
    const add = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not reach the server'))
      .mockResolvedValueOnce(undefined)
    const { onClose } = renderDialog([makeItem('a')], {
      context: 'add',
      onAdd: add
    })
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Description (alt text)' }),
      { target: { value: 'A heron' } }
    )

    fireEvent.click(addButton(1))
    expect(await screen.findByText('Could not reach the server')).toBeVisible()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(addButton(1))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(updateMediaDetailsMock).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledTimes(2)
  })

  describe('Apply to all', () => {
    it('is a row of chips, only with several photos', () => {
      const { unmount } = renderDialog([makeItem('a')], {
        context: 'add',
        onAdd: onAdd()
      })
      expect(screen.queryByText('Apply to all')).not.toBeInTheDocument()
      unmount()

      renderDialog([makeItem('a'), makeItem('b')], {
        context: 'add',
        onAdd: onAdd()
      })
      const row = screen.getByRole('region', { name: 'Apply to all' })
      expect(
        within(row)
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual(['Subject', 'Place', 'Gear'])
    })

    it('copies the visible photo’s place and gear to every photo on Add', async () => {
      renderDialog([makeItem('a'), makeItem('b'), makeItem('c')], {
        context: 'add',
        onAdd: onAdd()
      })
      await screen.findByRole('option', { name: 'Nikon Z9' })
      fireEvent.change(screen.getByLabelText('Place name'), {
        target: { value: 'Kruger' }
      })
      fireEvent.change(screen.getByLabelText('Camera'), {
        target: { value: 'cam-1' }
      })
      const row = screen.getByRole('region', { name: 'Apply to all' })
      fireEvent.click(within(row).getByRole('button', { name: 'Place' }))
      fireEvent.click(within(row).getByRole('button', { name: 'Gear' }))
      expect(
        within(row).getByRole('button', { name: 'Place' })
      ).toHaveAttribute('aria-pressed', 'true')

      fireEvent.click(addButton(3))

      await waitFor(() =>
        expect(updateMediaDetailsMock).toHaveBeenCalledTimes(3)
      )
      for (const id of ['a', 'b', 'c']) {
        expect(updateMediaDetailsMock).toHaveBeenCalledWith(
          id,
          expect.objectContaining({
            place_name: 'Kruger',
            camera_gear_id: 'cam-1'
          })
        )
      }
    })

    it('copies the subject too', async () => {
      renderDialog([makeItem('a'), makeItem('b')], {
        context: 'add',
        onAdd: onAdd(),
        settings: null
      })
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Grey Heron' }
      })
      const row = screen.getByRole('region', { name: 'Apply to all' })
      fireEvent.click(within(row).getByRole('button', { name: 'Subject' }))

      fireEvent.click(addButton(2))

      await waitFor(() =>
        expect(updateMediaDetailsMock).toHaveBeenCalledTimes(2)
      )
      expect(updateMediaDetailsMock).toHaveBeenCalledWith(
        'b',
        expect.objectContaining({ subject_name: 'Grey Heron' })
      )
    })
  })

  describe('cancelling', () => {
    it('discards at once when nothing was changed', () => {
      const { onDiscard, onClose } = renderDialog([makeItem('a')], {
        context: 'add',
        onAdd: onAdd(),
        withDiscard: true
      })

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(onDiscard).toHaveBeenCalledTimes(1)
      expect(onClose).not.toHaveBeenCalled()
    })

    it('asks first when something was changed, and can keep editing', () => {
      const { onDiscard } = renderDialog([makeItem('a'), makeItem('b')], {
        context: 'add',
        onAdd: onAdd(),
        withDiscard: true
      })
      fireEvent.change(
        screen.getByRole('textbox', { name: 'Description (alt text)' }),
        { target: { value: 'A heron' } }
      )

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      const ask = screen.getByRole('group', { name: 'Discard photos' })
      expect(ask).toHaveTextContent('Discard these photos?')
      expect(onDiscard).not.toHaveBeenCalled()

      fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
      expect(
        screen.queryByRole('group', { name: 'Discard photos' })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('textbox', { name: 'Description (alt text)' })
      ).toHaveValue('A heron')
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('discards after confirming', () => {
      const { onDiscard } = renderDialog([makeItem('a')], {
        context: 'add',
        onAdd: onAdd(),
        withDiscard: true
      })
      fireEvent.change(
        screen.getByRole('textbox', { name: 'Description (alt text)' }),
        { target: { value: 'A heron' } }
      )

      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

      expect(onDiscard).toHaveBeenCalledTimes(1)
    })

    it('closes with Escape the same way', () => {
      const { onDiscard } = renderDialog([makeItem('a')], {
        context: 'add',
        onAdd: onAdd(),
        withDiscard: true
      })

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

      expect(onDiscard).toHaveBeenCalledTimes(1)
    })
  })
})
