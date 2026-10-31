/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { MediaStorageSaveFileOutput } from '@/lib/services/medias/types'

import {
  gears,
  getGalleryGearsMock,
  getMediaMock,
  makeItem,
  renderDialog
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

// Stands in for the photo editor: a button that reports a saved edit, the way
// the editor does after Save.
vi.mock('@/lib/components/photo-editor/PhotoEditPreview', () => ({
  PhotoEditPreview: ({
    item,
    onEdited,
    children
  }: {
    item: { id: string }
    onEdited: (
      id: string,
      media: MediaStorageSaveFileOutput,
      posts: { updated: string[]; skipped: string[] }
    ) => void
    children: ReactNode
  }) => (
    <div>
      {children}
      <button
        type="button"
        onClick={() =>
          onEdited(
            item.id,
            {
              id: item.id,
              type: 'image',
              mime_type: 'image/jpeg',
              url: `https://example.test/${item.id}-edited.jpg`,
              preview_url: null,
              text_url: null,
              remote_url: null,
              description: null,
              meta: { original: { width: 800, height: 600 } }
            } as unknown as MediaStorageSaveFileOutput,
            { updated: [], skipped: [] }
          )
        }
      >
        Save fake edit
      </button>
    </div>
  )
}))

describe('MediaDetailsDialog adding a photo edited in the photo editor', () => {
  const originalResizeObserver = global.ResizeObserver

  beforeEach(() => {
    vi.clearAllMocks()
    getGalleryGearsMock.mockResolvedValue(gears)
    getMediaMock.mockImplementation(() => new Promise(() => {}))
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })

  afterEach(() => {
    cleanup()
    global.ResizeObserver = originalResizeObserver
  })

  it('asks before cancelling once a photo was edited, and shows the edit in the strip', () => {
    const { onDiscard } = renderDialog([makeItem('a'), makeItem('b')], {
      context: 'add',
      onAdd: vi.fn().mockResolvedValue(undefined),
      withDiscard: true
    })

    fireEvent.click(screen.getByRole('button', { name: 'Save fake edit' }))

    const strip = screen.getByRole('list', { name: 'Items' })
    expect(within(strip).getByRole('button', { name: 'Item 1' })).toHaveStyle({
      backgroundImage: 'url("https://example.test/a-edited.jpg")'
    })

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(
      screen.getByRole('group', { name: 'Discard photos' })
    ).toHaveTextContent('Discard these photos?')
    expect(onDiscard).not.toHaveBeenCalled()
  })
})
