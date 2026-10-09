/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { GalleryAlbumSuggestionReview } from '@/app/(timeline)/gallery/albums/GalleryAlbumSuggestionReview'
import { getGalleryAlbumSuggestionMedia } from '@/lib/client'
import { buildSuggestion } from '@/lib/components/gallery/__fixtures__/galleryAlbumSuggestions'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryAlbumSuggestionEntity } from '@/lib/services/gallery/galleryAlbumSuggestionEntities'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

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
    const first = createDeferred<{ items: GalleryItemEntity[] }>()
    media.mockImplementationOnce(() => first.promise)
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
    await act(async () => {
      first.resolve({ items: [buildGalleryItem('old-1')] })
    })

    await waitFor(() => expect(media).toHaveBeenCalledTimes(2))
    expect(
      screen.getAllByRole('button', { name: /^Select Photo \d+$/ })
    ).toHaveLength(3)
  })

  describe('Select all', () => {
    it('adds the suggestion to the picks and keeps the other picks and the cover', async () => {
      // The owner added two photos of their own, took one suggested photo out,
      // and put the first of their own at the front as the cover.
      render(
        <Harness
          suggestion={buildSuggestion('s')}
          initial={['own-1', 's-1', 'own-2']}
        />
      )
      await screen.findAllByRole('button', { name: /^Select Photo \d+$/ })

      fireEvent.click(screen.getByRole('button', { name: 'Select all' }))

      expect(screen.getByTestId('selected')).toHaveTextContent(
        'own-1,s-1,own-2,s-2,s-3'
      )
    })

    it('adds only what fits in the album', async () => {
      render(
        <Harness
          suggestion={buildSuggestion('s')}
          initial={['own-1']}
          capacity={2}
        />
      )
      await screen.findAllByRole('button', { name: /^Select Photo \d+$/ })

      fireEvent.click(screen.getByRole('button', { name: 'Select all' }))

      expect(screen.getByTestId('selected')).toHaveTextContent('own-1,s-1')
      expect(screen.getByRole('button', { name: 'Select all' })).toBeDisabled()
    })
  })

  describe('filters', () => {
    const place = (name: string) =>
      ({
        name,
        precision: 'exact',
        latitude: 1,
        longitude: 2,
        countryCode: 'GB'
      }) as GalleryItemEntity['place']
    const subject = (name: string) =>
      ({
        name,
        scientificName: null,
        category: 'bird',
        taxonKey: null,
        taxonPath: null
      }) as GalleryItemEntity['subject']
    const mixed = (ids: string[]) =>
      Promise.resolve({
        items: ids.map((id, index) =>
          buildGalleryItem(id, {
            subject: subject(index % 2 === 0 ? 'Kingfisher' : 'Heron'),
            place: place(index < 2 ? 'Lee Valley' : 'Hyde Park'),
            takenAt: `2026-06-0${index + 1}T10:00:00Z`
          })
        )
      })
    const suggestion = buildSuggestion('s', {
      mediaIds: ['s-1', 's-2', 's-3', 's-4'],
      photoCount: 4
    })
    const shown = () =>
      screen
        .getAllByRole('button', { name: /^Select (Kingfisher|Heron)/ })
        .map((tile) => tile.getAttribute('aria-label'))

    beforeEach(() => {
      media.mockImplementation((ids) => mixed(ids))
    })

    it('narrows the grid by species, place and date, and clears the filters', async () => {
      render(<Harness suggestion={suggestion} />)
      await screen.findAllByRole('button', {
        name: /^Select (Kingfisher|Heron)/
      })
      expect(shown()).toHaveLength(4)

      fireEvent.change(screen.getByLabelText('Species'), {
        target: { value: 'Kingfisher' }
      })
      expect(shown()).toHaveLength(2)

      fireEvent.change(screen.getByLabelText('Place'), {
        target: { value: 'Hyde Park' }
      })
      expect(shown()).toHaveLength(1)

      fireEvent.change(screen.getByLabelText('Taken from'), {
        target: { value: '2026-06-04' }
      })
      expect(
        screen.getByText('No photos match these filters.')
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(shown()).toHaveLength(4)
      expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    })

    it('selects only the shown photos while a filter is on, keeping the other picks', async () => {
      render(<Harness suggestion={suggestion} initial={['own-1']} />)
      await screen.findAllByRole('button', {
        name: /^Select (Kingfisher|Heron)/
      })

      fireEvent.change(screen.getByLabelText('Place'), {
        target: { value: 'Lee Valley' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))

      expect(screen.getByTestId('selected')).toHaveTextContent('own-1,s-1,s-2')
    })

    it('shows the full grid and "Select all" again when the review is remounted for another suggestion', async () => {
      // The dialog keys the review by suggestion (and by each Use).
      const view = (key: string, ids: string[]) => (
        <GalleryAlbumSuggestionReview
          key={key}
          suggestion={buildSuggestion('t', {
            mediaIds: ids,
            photoCount: ids.length
          })}
          selected={[]}
          onChange={() => {}}
        />
      )
      const { rerender } = render(view('trip:1', ['t-1', 't-2', 't-3', 't-4']))
      await screen.findAllByRole('button', {
        name: /^Select (Kingfisher|Heron)/
      })
      fireEvent.change(screen.getByLabelText('Place'), {
        target: { value: 'Hyde Park' }
      })
      expect(shown()).toHaveLength(2)
      expect(
        screen.getByRole('button', { name: 'Select all shown' })
      ).toBeInTheDocument()

      rerender(view('species:2', ['t-1', 't-2', 't-3']))

      await waitFor(() => expect(shown()).toHaveLength(3))
      expect(screen.getByLabelText('Place')).toHaveValue('')
      expect(
        screen.getByRole('button', { name: 'Select all' })
      ).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull()
    })

    it('does not submit the dialog form when Enter is pressed in a date field', async () => {
      const onSubmit = vi.fn((event) => event.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <Harness suggestion={suggestion} />
        </form>
      )
      await screen.findAllByRole('button', {
        name: /^Select (Kingfisher|Heron)/
      })

      fireEvent.keyDown(screen.getByLabelText('Taken from'), { key: 'Enter' })

      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
