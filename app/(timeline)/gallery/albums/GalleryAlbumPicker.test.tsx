/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'

import { GalleryAlbumPicker } from '@/app/(timeline)/gallery/albums/GalleryAlbumPicker'
import { getGalleryMedia, getGallerySubjects } from '@/lib/client'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryItemEntity } from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'

vi.mock('@/lib/client', () => ({
  getGalleryMedia: vi.fn(),
  getGallerySubjects: vi.fn()
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>
}))

const media = vi.mocked(getGalleryMedia)
const subjects = vi.mocked(getGallerySubjects)

const place = (name: string) =>
  ({
    name,
    precision: 'exact',
    latitude: 1,
    longitude: 2,
    countryCode: 'GB'
  }) as GalleryItemEntity['place']

const named = (
  id: string,
  name: string,
  overrides: Partial<GalleryItemEntity> = {}
) =>
  buildGalleryItem(id, {
    attachment: { ...buildGalleryItem(id).attachment, name },
    ...overrides
  })

const Harness = ({
  capacity = 2000,
  existingIds,
  initialSelected = [],
  seedItems,
  onFirstItemChange,
  columns
}: {
  capacity?: number
  existingIds?: string[]
  initialSelected?: string[]
  seedItems?: GalleryItemEntity[]
  onFirstItemChange?: (item: GalleryItemEntity | null) => void
  columns?: 4 | 5
}) => {
  const [selected, setSelected] = useState<string[]>(initialSelected)
  return (
    <>
      <GalleryAlbumPicker
        ownerId="owner"
        selected={selected}
        onChange={setSelected}
        onFirstItemChange={onFirstItemChange}
        capacity={capacity}
        existingIds={existingIds}
        seedItems={seedItems}
        columns={columns}
      />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  )
}

describe('GalleryAlbumPicker', () => {
  let mockObserverCallback:
    ((entries: IntersectionObserverEntry[]) => void) | null = null

  beforeEach(() => {
    mockObserverCallback = null
    Object.defineProperty(globalThis, 'IntersectionObserver', {
      writable: true,
      configurable: true,
      value: class {
        constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
          mockObserverCallback = callback
        }
        observe = vi.fn()
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    })

    media.mockReset()
    subjects.mockReset()
    subjects.mockResolvedValue({
      groups: [
        {
          category: 'bird',
          subjects: [{ key: 'sci:alcedo atthis', name: 'Common Kingfisher' }]
        }
      ],
      unidentifiedCount: 0,
      countryCount: null
    } as never)
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'IntersectionObserver')
  })

  it('requests show: all from getGalleryMedia', async () => {
    media.mockResolvedValue({ items: [], nextMaxId: null })
    render(<Harness />)
    await screen.findByText('No photos yet')
    expect(media).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ show: 'all' })
    )
  })

  it('ticks photos in the order picked and unticks them again', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextMaxId: null
    })
    render(<Harness />)

    const robin = await screen.findByRole('button', {
      name: 'Select Robin, photo 2, 14 Mar 2025'
    })
    expect(robin).toHaveClass('cursor-pointer')
    fireEvent.click(robin)
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Heron, photo 1, 14 Mar 2025'
      })
    )
    expect(screen.getByTestId('selected')).toHaveTextContent('2,1')
    expect(robin).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(robin)
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('')
  })

  it('stops at the capacity', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextMaxId: null
    })
    render(<Harness capacity={2} />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Select all shown' })
    )
    expect(screen.getByTestId('selected')).toHaveTextContent('1,2')
    expect(
      screen.getByRole('button', { name: 'Select Fox, photo 3, 14 Mar 2025' })
    ).toBeDisabled()
  })

  it('asks the server for a species and filters place and dates over what is loaded', async () => {
    media.mockResolvedValue({
      items: [
        named('1', 'Heron', {
          takenAt: '2026-05-02T10:00:00Z',
          place: place('Lee Valley')
        }),
        named('2', 'Robin', {
          takenAt: '2026-06-21T10:00:00Z',
          place: place('Hyde Park')
        })
      ],
      nextMaxId: null
    })
    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 2 May 2026'
    })

    fireEvent.change(screen.getByLabelText('Place'), {
      target: { value: 'Hyde Park' }
    })
    expect(
      screen.queryByRole('button', { name: /^Select Heron/ })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Select Robin, photo 1, 21 Jun 2026'
      })
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2026-07-01' }
    })
    expect(
      screen.getByText('No photos match these filters.')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(
      screen.getByRole('button', {
        name: 'Select Heron, photo 1, 2 May 2026'
      })
    ).toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText('Species'), {
      target: { value: 'sci:alcedo atthis' }
    })
    await waitFor(() =>
      expect(media).toHaveBeenLastCalledWith(
        'owner',
        expect.objectContaining({ subject: 'sci:alcedo atthis' })
      )
    )
  })

  it('auto-loads page 2 with cursor when sentinel is visible and keeps the picks', async () => {
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextMaxId: '1'
      })
      .mockResolvedValueOnce({
        items: [named('0', 'Robin')],
        nextMaxId: null
      })
    render(<Harness />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Select Heron, photo 1, 14 Mar 2025'
      })
    )

    await waitFor(() => expect(mockObserverCallback).not.toBeNull())

    act(() => {
      mockObserverCallback!([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    expect(
      await screen.findByRole('button', {
        name: 'Select Robin, photo 2, 14 Mar 2025'
      })
    ).toBeInTheDocument()
    expect(media).toHaveBeenLastCalledWith(
      'owner',
      expect.objectContaining({ maxId: '1', show: 'all' })
    )
    expect(screen.getByTestId('selected')).toHaveTextContent('1')
  })

  it('shows skeletons while page 2 is pending', async () => {
    const page2 = createDeferred<{
      items: GalleryItemEntity[]
      nextMaxId: string | null
    }>()
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextMaxId: '1'
      })
      .mockImplementationOnce(() => page2.promise)

    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 14 Mar 2025'
    })

    const statusEl = document.querySelector<HTMLElement>('div[role="status"]')!
    expect(statusEl).toBeInTheDocument()
    expect(statusEl).toHaveTextContent('')
    expect(screen.getByRole('list')).not.toContainElement(statusEl)

    await waitFor(() => expect(mockObserverCallback).not.toBeNull())

    act(() => {
      mockObserverCallback!([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    expect(await screen.findByText('Loading more photos')).toBeInTheDocument()
    expect(statusEl).toHaveTextContent('Loading more photos')
    const skeletons = document.querySelectorAll('.skeleton')
    expect(skeletons).toHaveLength(4)
    expect(skeletons[3].parentElement).toHaveClass('hidden sm:block')

    await act(async () => {
      page2.resolve({ items: [named('2', 'Robin')], nextMaxId: null })
    })

    await waitFor(() =>
      expect(screen.queryByText('Loading more photos')).not.toBeInTheDocument()
    )
    expect(statusEl).toHaveTextContent('')
    expect(
      screen.getByRole('button', {
        name: 'Select Robin, photo 2, 14 Mar 2025'
      })
    ).toBeInTheDocument()
  })

  it('shows Try again after page 2 failure and retries with the same cursor', async () => {
    media
      .mockResolvedValueOnce({
        items: [named('1', 'Heron')],
        nextMaxId: '1'
      })
      .mockRejectedValueOnce(new Error('Network error on page 2'))

    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 14 Mar 2025'
    })

    await waitFor(() => expect(mockObserverCallback).not.toBeNull())

    act(() => {
      mockObserverCallback!([
        { isIntersecting: true } as IntersectionObserverEntry
      ])
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Network error on page 2'
    )
    const tryAgain = screen.getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeInTheDocument()

    media.mockResolvedValueOnce({
      items: [named('2', 'Robin')],
      nextMaxId: null
    })

    fireEvent.click(tryAgain)

    expect(media).toHaveBeenLastCalledWith(
      'owner',
      expect.objectContaining({ maxId: '1', show: 'all' })
    )
    expect(
      await screen.findByRole('button', {
        name: 'Select Robin, photo 2, 14 Mar 2025'
      })
    ).toBeInTheDocument()
  })

  it('points an empty gallery to All media with updated copy', async () => {
    media.mockResolvedValue({ items: [], nextMaxId: null })
    render(<Harness />)
    expect(await screen.findByText('No photos yet')).toBeInTheDocument()
    expect(
      screen.getByText('Photos you post, or add in Gallery, show up here.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to All media' })
    ).toHaveAttribute('href', '/gallery/media')
  })

  it('shows a load failure on initial load and retries', async () => {
    media
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [named('1', 'Heron')], nextMaxId: null })
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('button', {
        name: 'Select Heron, photo 1, 14 Mar 2025'
      })
    ).toBeInTheDocument()
  })

  it('names photos of one species apart', async () => {
    media.mockResolvedValue({
      items: ['1', '2', '3'].map((id) => named(id, 'Common kingfisher')),
      nextMaxId: null
    })
    render(<Harness />)

    await screen.findByRole('button', {
      name: 'Select Common kingfisher, photo 3, 14 Mar 2025'
    })
    const names = screen
      .getAllByRole('button', { name: /^Select / })
      .map((button) => button.getAttribute('aria-label'))
      .filter(Boolean)
    expect(names).toEqual([
      'Select Common kingfisher, photo 1, 14 Mar 2025',
      'Select Common kingfisher, photo 2, 14 Mar 2025',
      'Select Common kingfisher, photo 3, 14 Mar 2025'
    ])
  })

  it('shows photos already in the album as such and never picks them', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextMaxId: null
    })
    render(<Harness existingIds={['2']} />)

    const member = await screen.findByRole('button', {
      name: 'Robin, photo 2, 14 Mar 2025, already in the album'
    })
    expect(member).toBeDisabled()
    expect(member).toHaveTextContent('In album')
    expect(member).not.toHaveAttribute('aria-pressed')
    expect(member).toHaveClass('cursor-pointer')

    fireEvent.click(screen.getByRole('button', { name: 'Select all shown' }))
    expect(screen.getByTestId('selected')).toHaveTextContent('1,3')
  })

  it('does not submit the dialog form when Enter is pressed in a date field', async () => {
    media.mockResolvedValue({ items: [named('1', 'Heron')], nextMaxId: null })
    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 14 Mar 2025'
    })

    for (const label of ['Taken from', 'Taken to']) {
      // fireEvent returns false when the default action was prevented.
      expect(
        fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' })
      ).toBe(false)
    }
  })

  it('knows the cover of a preselected photo that is not in the loaded pages', async () => {
    media.mockResolvedValue({ items: [named('2', 'Robin')], nextMaxId: null })
    const onFirstItemChange = vi.fn()
    const seed = named('9', 'Heron')
    render(
      <Harness
        initialSelected={['9']}
        seedItems={[seed]}
        onFirstItemChange={onFirstItemChange}
      />
    )
    await screen.findByRole('button', {
      name: 'Select Robin, photo 1, 14 Mar 2025'
    })

    expect(onFirstItemChange).toHaveBeenLastCalledWith(seed)
  })

  it('has no cover for a preselected photo it was not told about', async () => {
    media.mockResolvedValue({ items: [named('2', 'Robin')], nextMaxId: null })
    const onFirstItemChange = vi.fn()
    render(
      <Harness initialSelected={['9']} onFirstItemChange={onFirstItemChange} />
    )
    await screen.findByRole('button', {
      name: 'Select Robin, photo 1, 14 Mar 2025'
    })

    expect(onFirstItemChange).toHaveBeenLastCalledWith(null)
  })

  it('gives selects and date inputs pointer-coarse:h-10', async () => {
    media.mockResolvedValue({ items: [named('1', 'Heron')], nextMaxId: null })
    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 14 Mar 2025'
    })

    expect(screen.getByLabelText('Species')).toHaveClass('pointer-coarse:h-10')
    expect(screen.getByLabelText('Place')).toHaveClass('pointer-coarse:h-10')
    expect(screen.getByLabelText('Taken from')).toHaveClass(
      'pointer-coarse:h-10'
    )
    expect(screen.getByLabelText('Taken to')).toHaveClass('pointer-coarse:h-10')
  })

  it('renders sm:grid-cols-5 when columns is 5 and sm:grid-cols-4 by default', async () => {
    media.mockResolvedValue({ items: [named('1', 'Heron')], nextMaxId: null })
    const { rerender } = render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 14 Mar 2025'
    })
    expect(screen.getByRole('list')).toHaveClass('sm:grid-cols-4')

    rerender(<Harness columns={5} />)
    expect(screen.getByRole('list')).toHaveClass('sm:grid-cols-5')
  })

  it('does not runaway auto-load when filtered: fetches at most MAX_AUTO_PAGES extra pages even when sentinel reports visible', async () => {
    let pageCount = 0
    media.mockImplementation(async () => {
      pageCount += 1
      return {
        items: [
          named(`item-${pageCount}`, 'Heron', {
            takenAt: '2020-01-01T00:00:00Z',
            place: place('London')
          })
        ],
        nextMaxId: `cursor-${pageCount}`
      }
    })

    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 1 Jan 2020'
    })
    expect(media).toHaveBeenCalledTimes(1)

    // Apply a date filter that matches nothing
    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2025-01-01' }
    })

    // Auto-pager should fetch up to MAX_AUTO_PAGES (5) extra pages
    await waitFor(() => expect(media).toHaveBeenCalledTimes(6))

    // Sentinel callback firing should NOT trigger loads because visible.length (0) < MIN_VISIBLE
    if (mockObserverCallback) {
      act(() => {
        mockObserverCallback!([
          { isIntersecting: true } as IntersectionObserverEntry
        ])
      })
    }

    // Give any potential microtasks/effects time to run
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(media).toHaveBeenCalledTimes(6)

    // The automatic paths are stopped, so a manual button continues from the cursor
    let resolvePage!: (v: { items: never[]; nextMaxId: null }) => void
    media.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve))
    )
    const loadMore = await screen.findByRole('button', {
      name: 'Load more photos'
    })
    loadMore.focus()
    fireEvent.click(loadMore)
    await waitFor(() => expect(media).toHaveBeenCalledTimes(7))
    // The button stays mounted (disabled, busy) so focus is not lost
    expect(loadMore).toBeInTheDocument()
    expect(loadMore).toBeDisabled()
    expect(loadMore).toHaveAttribute('aria-busy', 'true')
    expect(document.activeElement).toBe(loadMore)
    await act(async () => resolvePage({ items: [], nextMaxId: null }))
    expect(media).toHaveBeenLastCalledWith(
      'owner',
      expect.objectContaining({ maxId: 'cursor-6' })
    )
    // Still no automatic runaway after the manual page
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(media).toHaveBeenCalledTimes(7)
  })

  it('does not show "Load more photos" while the last automatic page loads', async () => {
    let pageCount = 0
    media.mockImplementation(async () => {
      pageCount += 1
      if (pageCount === 6) return new Promise(() => {})
      return {
        items: [
          named(`item-${pageCount}`, 'Heron', {
            takenAt: '2020-01-01T00:00:00Z'
          })
        ],
        nextMaxId: `cursor-${pageCount}`
      }
    })
    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 1 Jan 2020'
    })
    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2025-01-01' }
    })
    await waitFor(() => expect(media).toHaveBeenCalledTimes(6))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(
      screen.queryByRole('button', { name: /Load(ing)? more photos/ })
    ).not.toBeInTheDocument()
  })

  it('does not show "Load more photos" when unfiltered', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron')],
      nextMaxId: 'cursor-1'
    })
    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 14 Mar 2025'
    })
    expect(
      screen.queryByRole('button', { name: 'Load more photos' })
    ).not.toBeInTheDocument()
  })

  it('resets the auto-page budget when the species filter changes', async () => {
    let pageCount = 0
    media.mockImplementation(async () => {
      pageCount += 1
      return {
        items: [
          named(`item-${pageCount}`, 'Heron', {
            takenAt: '2020-01-01T00:00:00Z'
          })
        ],
        nextMaxId: `cursor-${pageCount}`
      }
    })

    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 1 Jan 2020'
    })
    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2025-01-01' }
    })
    await waitFor(() => expect(media).toHaveBeenCalledTimes(6))

    fireEvent.change(await screen.findByLabelText('Species'), {
      target: { value: 'sci:alcedo atthis' }
    })
    // 1 restart fetch + a fresh budget of 5 auto pages
    await waitFor(() => expect(media).toHaveBeenCalledTimes(12))
    // Call 7 is the restart (no cursor). The first auto page after it must
    // continue from the restart's cursor, not the old query's cursor-6.
    expect(media.mock.calls[6][1]).toEqual(
      expect.objectContaining({ maxId: undefined })
    )
    expect(media.mock.calls[7][1]).toEqual(
      expect.objectContaining({ maxId: 'cursor-7' })
    )
  })

  it('resets the autoPages counter when switching directly from one active filter to another', async () => {
    let pageCount = 0
    media.mockImplementation(async () => {
      pageCount += 1
      return {
        items: [
          named(`item-${pageCount}`, 'Heron', {
            takenAt: '2020-01-01T00:00:00Z',
            place: place('London')
          })
        ],
        nextMaxId: `cursor-${pageCount}`
      }
    })

    render(<Harness />)
    await screen.findByRole('button', {
      name: 'Select Heron, photo 1, 1 Jan 2020'
    })
    expect(media).toHaveBeenCalledTimes(1)

    // First active filter: Taken from '2025-01-01'. Matches nothing.
    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2025-01-01' }
    })

    // Exhausts 5 auto pages (total 6 calls)
    await waitFor(() => expect(media).toHaveBeenCalledTimes(6))

    // Switch directly to another active filter: Taken from '2026-01-01'
    fireEvent.change(screen.getByLabelText('Taken from'), {
      target: { value: '2026-01-01' }
    })

    // Should reset autoPages counter and fetch again up to MAX_AUTO_PAGES extra pages
    await waitFor(() => expect(media).toHaveBeenCalledTimes(11))
  })

  it('disables "Select all shown" when every visible photo is selected or already in the album', async () => {
    media.mockResolvedValue({
      items: [named('1', 'Heron'), named('2', 'Robin'), named('3', 'Fox')],
      nextMaxId: null
    })
    render(<Harness existingIds={['3']} />)

    const selectAllBtn = await screen.findByRole('button', {
      name: 'Select all shown'
    })
    expect(selectAllBtn).toBeEnabled()

    // Click "Select all shown" to select 1 and 2 (3 is an existing member)
    fireEvent.click(selectAllBtn)
    expect(screen.getByTestId('selected')).toHaveTextContent('1,2')

    // Now every visible photo is either selected (1, 2) or an album member (3)
    expect(selectAllBtn).toBeDisabled()

    // Unselect photo 1
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select Heron, photo 1, 14 Mar 2025'
      })
    )
    expect(screen.getByTestId('selected')).toHaveTextContent('2')

    // Since photo 1 is visible and neither selected nor member, button is enabled again
    expect(selectAllBtn).toBeEnabled()
  })
})
