/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { getGalleryMedia } from '@/lib/client'
import { GalleryDayHeader } from '@/lib/components/gallery/GalleryDayHeader'
import { GalleryPagedGrid } from '@/lib/components/gallery/GalleryPagedGrid'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import { groupGalleryItemsByDay } from '@/lib/components/gallery/galleryDayGroups'
import { useDaySelection } from '@/lib/components/gallery/useDaySelection'
import type {
  GalleryDayKey,
  GalleryDayStats,
  GalleryItemEntity
} from '@/lib/services/gallery/galleryEntities'
import type { GalleryMediaSort } from '@/lib/types/database/gallery'

vi.mock('@/lib/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/client')>()),
  getGalleryMedia: vi.fn()
}))

const getGalleryMediaMock = vi.mocked(getGalleryMedia)

const DAY: GalleryDayKey = '2025-10-04'

const dayItems = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    buildGalleryItem(`p${index + 1}`, {
      takenAt: `${DAY}T09:0${index}:00.000Z`
    })
  )

// The wiring GalleryAllMediaView uses, against the real paged grid and
// grid: day headers memoised on pickedInDay's identity, tiles noted as
// each page arrives, a fresh grid per sort.
const Host = ({ sort }: { sort: GalleryMediaSort }) => {
  const [selected, setSelected] = useState<string[]>([])
  const day = useDaySelection({
    selected,
    onChange: setSelected,
    sort,
    room: null,
    resetKey: sort,
    fetchIds: async () => []
  })
  const handleItemsChange = useCallback(
    (items: GalleryItemEntity[]) => {
      day.noteItems(items)
    },
    [day.noteItems]
  )
  const renderGroups = useCallback(
    (
      items: GalleryItemEntity[],
      days: Record<GalleryDayKey, GalleryDayStats>
    ) =>
      groupGalleryItemsByDay(items, sort).map((group) => ({
        key: group.key,
        items: group.items,
        header: (
          <GalleryDayHeader
            as="h2"
            dayKey={group.key}
            stats={days[group.key]}
            loadedCount={group.items.length}
            loadedInAlbum={0}
            picked={day.pickedInDay(group.key)}
            selecting
            hasAlbum={false}
            room={null}
            busyKey={day.busyKey}
            busyCount={day.busyKey === group.key ? day.busyCount : 0}
            onSelectDay={day.selectDay}
            onDeselectDay={day.deselectDay}
          />
        )
      })),
    [
      sort,
      day.pickedInDay,
      day.selectDay,
      day.deselectDay,
      day.busyKey,
      day.busyCount
    ]
  )
  return (
    <div>
      <GalleryPagedGrid
        key={sort}
        actorId="actor-1"
        sort={sort}
        renderGroups={renderGroups}
        selection={{
          selected: new Set(selected),
          anchorId: null,
          onToggle: (item) =>
            setSelected((current) =>
              current.includes(item.mediaId)
                ? current.filter((id) => id !== item.mediaId)
                : [...current, item.mediaId]
            )
        }}
        onItemsChange={handleItemsChange}
      />
    </div>
  )
}

describe('day headers after a sort change', () => {
  it('counts the picks again once the reloaded tiles are noted', async () => {
    const items = dayItems(3)
    getGalleryMediaMock.mockResolvedValue({ items, nextMaxId: null })

    const view = render(<Host sort="taken_desc" />)

    // Wait for the page, then pick every photo of the day.
    await screen.findByRole('button', { name: 'Select day, Sat 4 Oct 2025' })
    for (const index of [1, 2, 3]) {
      fireEvent.click(
        screen.getByRole('button', {
          name: `Select media ${index}, taken 4 Oct 2025`
        })
      )
    }
    expect(
      screen.getByRole('button', { name: 'Deselect day, Sat 4 Oct 2025' })
    ).toBeInTheDocument()
    expect(screen.getByText('3 photos · all picked')).toBeInTheDocument()

    // A sort change is a new query: the grid remounts, the hook's day map
    // is cleared and the reloaded page's tiles are noted as they arrive.
    getGalleryMediaMock.mockResolvedValue({
      items: [...items].reverse(),
      nextMaxId: null
    })
    view.rerender(<Host sort="taken_asc" />)

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Deselect day, Sat 4 Oct 2025' })
      ).toBeInTheDocument()
    )
    expect(screen.getByText('3 photos · all picked')).toBeInTheDocument()
  })
})
