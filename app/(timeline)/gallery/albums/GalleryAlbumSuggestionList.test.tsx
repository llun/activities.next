/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { GalleryAlbumSuggestionList } from '@/app/(timeline)/gallery/albums/GalleryAlbumSuggestionList'
import type { GalleryAlbumSuggestionsState } from '@/app/(timeline)/gallery/albums/useGalleryAlbumSuggestions'
import { buildSuggestion } from '@/lib/components/gallery/__fixtures__/galleryAlbumSuggestions'

const renderList = (
  state: GalleryAlbumSuggestionsState,
  props: Partial<Parameters<typeof GalleryAlbumSuggestionList>[0]> = {}
) => {
  const onUse = vi.fn()
  const onRetry = vi.fn()
  render(
    <GalleryAlbumSuggestionList
      state={state}
      onRetry={onRetry}
      activeId={null}
      onUse={onUse}
      {...props}
    />
  )
  return { onUse, onRetry }
}

const suggestions = [
  buildSuggestion('trip:2026-09-12', {
    photoCount: 86,
    placeCount: 4,
    speciesCount: 11
  }),
  buildSuggestion('species:sci:alcedo atthis', {
    kind: 'species',
    title: 'Common kingfisher',
    photoCount: 23,
    firstAt: '2024-03-01T10:00:00.000Z',
    lastAt: '2026-05-01T10:00:00.000Z'
  }),
  buildSuggestion('activity_day:2026-09-27', {
    kind: 'activity_day',
    title: 'Activity day, 27 Sep 2026',
    photoCount: 9,
    firstAt: '2026-09-27T08:00:00.000Z',
    lastAt: '2026-09-27T11:00:00.000Z',
    activityCount: 1,
    placeCount: 0,
    speciesCount: 0
  })
]

describe('GalleryAlbumSuggestionList', () => {
  it('announces that suggestions are loading', () => {
    renderList({ status: 'loading' })

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading suggestions')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says there is nothing to suggest, and how suggestions appear', () => {
    renderList({ status: 'ready', suggestions: [] })

    expect(screen.getByText('No suggestions right now')).toBeInTheDocument()
    expect(screen.getByText(/once you have enough photos/)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows the error with a way to try again', () => {
    const { onRetry } = renderList({
      status: 'error',
      message: 'Too many requests'
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Too many requests')
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('lists each suggestion with its title, kind, counts and a Use button', () => {
    renderList({ status: 'ready', suggestions })

    const rows = within(
      screen.getByRole('list', { name: 'Suggested albums' })
    ).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('Kruger, September 2026')).toBeVisible()
    expect(
      within(rows[0]).getByText(
        'Trip · 86 photos · 12 – 19 Sep 2026 · 4 places · 11 species'
      )
    ).toBeVisible()
    expect(
      within(rows[1]).getByText('Species · 23 photos · 1 Mar 2024 – 1 May 2026')
    ).toBeVisible()
    expect(
      within(rows[2]).getByText(
        'Activity day · 9 photos · 27 Sep 2026 · matches a recorded activity'
      )
    ).toBeVisible()
    expect(
      within(rows[0]).getByRole('button', {
        name: /^Use 86 photos from Kruger/
      })
    ).toHaveTextContent('Use 86')
  })

  it('starts the accessible name with the visible label, so voice control can use it', () => {
    renderList({ status: 'ready', suggestions })

    expect(
      screen.getByRole('button', {
        name: 'Use 23 photos from Common kingfisher'
      })
    ).toBeInTheDocument()
  })

  it('reports the suggestion whose Use button is pressed', () => {
    const { onUse } = renderList({ status: 'ready', suggestions })

    fireEvent.click(
      screen.getByRole('button', { name: /^Use 23 photos from Common/ })
    )

    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse).toHaveBeenCalledWith(suggestions[1])
  })

  it('marks the suggestion in use as current, without making the button a toggle', () => {
    renderList(
      { status: 'ready', suggestions },
      { activeId: 'species:sci:alcedo atthis' }
    )

    const used = screen.getByRole('button', {
      name: /^Use 23 photos from Common/
    })
    expect(used).toHaveAttribute('aria-current', 'true')
    expect(used).not.toHaveAttribute('aria-pressed')
    expect(
      screen.getByRole('button', { name: /^Use 86 photos from Kruger/ })
    ).not.toHaveAttribute('aria-current')
  })

  it('disables the buttons while the dialog is saving', () => {
    renderList({ status: 'ready', suggestions }, { disabled: true })

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
  })

  it('counts several activities and uses a placeholder when there is no preview', () => {
    renderList({
      status: 'ready',
      suggestions: [
        buildSuggestion('activity_day:2026-09-28', {
          kind: 'activity_day',
          title: 'Activity day, 28 Sep 2026',
          activityCount: 2,
          preview: null
        })
      ]
    })

    expect(
      screen.getByText(/matches 2 recorded activities/)
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
