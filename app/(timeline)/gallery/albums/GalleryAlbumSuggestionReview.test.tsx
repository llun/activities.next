/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { GalleryAlbumSuggestionReview } from '@/app/(timeline)/gallery/albums/GalleryAlbumSuggestionReview'
import { getGalleryAlbumSuggestionMedia } from '@/lib/client'
import { buildSuggestion } from '@/lib/components/gallery/__fixtures__/galleryAlbumSuggestions'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'

vi.mock('@/lib/client', () => ({
  getGalleryAlbumSuggestionMedia: vi.fn()
}))

const media = vi.mocked(getGalleryAlbumSuggestionMedia)

const answerWithIds = (ids: string[]) =>
  Promise.resolve({ items: ids.map((id) => buildGalleryItem(id)) })

const Harness = ({
  suggestion,
  initial,
  capacity,
  onItemsLoaded
}: {
  suggestion: GalleryAlbumSuggestionEntity
  initial?: string[]
  capacity?: number
  onItemsLoaded?: (items: unknown[]) => void
}) => {
  const [selected, setSelected] = useState<string[]>(
    initial ?? suggestion.mediaIds
  )
  return (
    <>
      <GalleryAlbumSuggestionReview
        suggestion={suggestion}
        selected={selected}
        onChange={setSelected}
        capacity={capacity}
        onItemsLoaded={onItemsLoaded}
      />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  )
}

describe('GalleryAlbumSuggestionReview', () => {
  beforeEach(() => {
    media.mockReset()
    media.mockImplementation((ids) => answerWithIds(ids))
  })

  it('shows the photos of the suggestion, all ticked, and reports them', async () => {
    const onItemsLoaded = vi.fn()
    const suggestion = buildSuggestion('s', { photoCount: 3 })
    render(<Harness suggestion={suggestion} onItemsLoaded={onItemsLoaded} />)

    expect(
      screen.getByRole('heading', { name: 'Review and trim the 3 photos' })
    ).toBeInTheDocument()
    expect(
      await screen.findAllByRole('button', { name: /^Select Photo \d+$/ })
    ).toHaveLength(3)
    for (const tile of screen.getAllByRole('button', {
      name: /^Select Photo \d+$/
    })) {
      expect(tile).toHaveAttribute('aria-pressed', 'true')
    }
    expect(media).toHaveBeenCalledWith(['s-1', 's-2', 's-3'])
    expect(onItemsLoaded).toHaveBeenCalledTimes(1)
    expect(onItemsLoaded.mock.calls[0][0]).toHaveLength(3)
  })

  it('unticks and reticks a photo without saving anything', async () => {
    render(<Harness suggestion={buildSuggestion('s')} />)

    const tiles = await screen.findAllByRole('button', {
      name: /^Select Photo \d+$/
    })
    fireEvent.click(tiles[1])
    expect(screen.getByTestId('selected')).toHaveTextContent('s-1,s-3')
    expect(tiles[1]).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(tiles[1])
    expect(screen.getByTestId('selected')).toHaveTextContent('s-1,s-3,s-2')
  })

  it('clears the selection and selects every photo again', async () => {
    render(<Harness suggestion={buildSuggestion('s')} />)
    await screen.findAllByRole('button', { name: /^Select Photo \d+$/ })

    expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement()
    expect(
      screen.getByRole('button', { name: 'Clear selection' })
    ).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('s-1,s-2,s-3')
  })

  it('loads the photos a page at a time', async () => {
    const ids = Array.from({ length: 75 }, (_, index) => `m${index + 1}`)
    render(
      <Harness
        suggestion={buildSuggestion('big', { mediaIds: ids, photoCount: 75 })}
      />
    )

    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /^Select Photo \d+$/ })
      ).toHaveLength(60)
    )
    expect(media).toHaveBeenCalledTimes(1)
    expect(media.mock.calls[0][0]).toHaveLength(60)

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: /^Select Photo \d+$/ })
      ).toHaveLength(75)
    )
    expect(media.mock.calls[1][0]).toEqual(ids.slice(60))
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('says when the suggestion is cut to what an album holds', async () => {
    render(
      <Harness
        suggestion={buildSuggestion('s', {
          truncated: true,
          photoCount: 2500,
          mediaIds: ['s-1', 's-2']
        })}
      />
    )
    await screen.findAllByRole('button', { name: /^Select Photo \d+$/ })

    expect(screen.getByText(/An album holds at most/)).toHaveTextContent(
      /newest 2 of the 2,500/
    )
  })

  it('stops adding photos at the capacity', async () => {
    render(
      <Harness
        suggestion={buildSuggestion('s')}
        initial={['s-1']}
        capacity={1}
      />
    )
    const tiles = await screen.findAllByRole('button', {
      name: /^Select Photo \d+$/
    })

    expect(tiles[1]).toBeDisabled()
    expect(tiles[0]).toBeEnabled()
  })

  it('shows the error and tries the first page again', async () => {
    media.mockRejectedValueOnce(new Error('Too many requests'))
    render(<Harness suggestion={buildSuggestion('s')} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findAllByRole('button', { name: /^Select Photo \d+$/ })
    ).toHaveLength(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('drops the answer for a suggestion that is no longer in use', async () => {
    let resolveFirst: (value: {
      items: ReturnType<typeof buildGalleryItem>[]
    }) => void = () => {}
    media.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    const { rerender } = render(
      <GalleryAlbumSuggestionReview
        suggestion={buildSuggestion('old')}
        selected={[]}
        onChange={() => {}}
      />
    )
    rerender(
      <GalleryAlbumSuggestionReview
        suggestion={buildSuggestion('new')}
        selected={[]}
        onChange={() => {}}
      />
    )
    await screen.findAllByRole('button', { name: /^Select Photo \d+$/ })
    resolveFirst({ items: [buildGalleryItem('old-1')] })

    await waitFor(() => expect(media).toHaveBeenCalledTimes(2))
    expect(
      screen.getAllByRole('button', { name: /^Select Photo \d+$/ })
    ).toHaveLength(3)
  })
})
