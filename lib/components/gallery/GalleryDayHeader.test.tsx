/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GalleryDayHeader } from '@/lib/components/gallery/GalleryDayHeader'
import type { GalleryDayStats } from '@/lib/services/gallery/galleryEntities'

const DAY = '2025-10-04'

const baseProps = {
  dayKey: DAY,
  loadedCount: 14,
  loadedInAlbum: 0,
  picked: 2,
  selecting: true,
  hasAlbum: false,
  room: null as number | null,
  onSelectDay: vi.fn(),
  onDeselectDay: vi.fn()
}

const stats = (overrides: Partial<GalleryDayStats> = {}): GalleryDayStats => ({
  count: 14,
  inAlbum: 0,
  placeName: 'Box Hill, Surrey',
  activity: null,
  ...overrides
})

describe('GalleryDayHeader', () => {
  it('renders the heading at the requested level', () => {
    const { rerender } = render(<GalleryDayHeader {...baseProps} as="h3" />)

    const heading = screen.getByRole('heading')
    expect(heading.tagName).toBe('H3')
    expect(heading).toHaveTextContent('Sat 4 Oct 2025')
    expect(heading).toHaveTextContent('Sat 4 Oct')

    rerender(<GalleryDayHeader {...baseProps} as="h2" />)
    expect(screen.getByRole('heading').tagName).toBe('H2')
  })

  it('prefers server stats over the loaded counts', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({ count: 27, placeName: 'Skomer Island', inAlbum: 3 })}
      />
    )

    expect(
      screen.getByText('Skomer Island · 27 photos · 2 picked · 3 in album')
    ).toBeInTheDocument()
  })

  it('falls back to the loaded counts when stats are absent', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        loadedCount={9}
        loadedInAlbum={4}
        picked={1}
      />
    )

    expect(
      screen.getByText('9 photos · 1 picked · 4 in album')
    ).toBeInTheDocument()
  })

  it('renders the activity chip with an aria-hidden emoji', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    // Both chips keep the emoji and the title.
    const emojis = screen.getAllByText('🚴')
    expect(emojis).toHaveLength(2)
    for (const emoji of emojis) {
      expect(emoji).toHaveAttribute('aria-hidden', 'true')
      expect(emoji.parentElement).toHaveTextContent('🚴 Ride · 64.2 km')
    }
    expect(emojis[0].parentElement).toHaveClass('hidden', 'sm:inline-flex')
  })

  it('shows the emoji, activity name and distance below sm', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    // Below sm the chip keeps the compact visible activity name beside the
    // emoji, so same-emoji activity types stay distinguishable.
    expect(phoneChip).toHaveTextContent('🚴 Ride · 64.2 km')
    expect(phoneChip).toHaveClass('sm:hidden', 'min-w-0', 'truncate')
    expect(phoneChip?.querySelector('.sr-only')).toBeNull()
  })

  it('shows the formatted activity title on phones when there is no emoji', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'swim',
            distanceMeters: 1500
          }
        })}
      />
    )

    const phoneChip = screen
      .getAllByText('Swim · 1.50 km')
      .find((chip) => chip.className.includes('sm:hidden'))

    expect(phoneChip).toHaveTextContent('Swim · 1.50 km')
    expect(phoneChip).toHaveClass('min-w-0', 'truncate')
  })

  it('shows the emoji and the activity name below sm when there is no distance', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: null
          }
        })}
      />
    )

    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    expect(phoneChip).toHaveTextContent('🚴 Ride')
  })

  it('keeps the phone meta to count and picked, truncating beside the chip', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    const meta = screen.getByText('14 · 2 picked')
    expect(meta).toHaveClass('sm:hidden', 'whitespace-nowrap')
    // Below sm the meta sits on row 2, where the line may wrap; the
    // phone meta cannot wrap, so it truncates via the min-w-0.
    expect(meta.parentElement).toHaveClass('min-w-0', 'truncate')
    expect(
      screen.getByText('Box Hill, Surrey · 14 photos · 2 picked')
    ).toHaveClass('max-sm:hidden')
    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    expect(phoneChip).toHaveClass('sm:hidden', 'min-w-0', 'truncate')
  })

  it('renders the two-row phone layout with the button beside the heading', () => {
    render(<GalleryDayHeader {...baseProps} />)

    const heading = screen.getByRole('heading')
    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    const root = heading.parentElement

    // Below sm the header is a two-row grid; at sm and up it stays the
    // same single flex row as before.
    expect(root).toHaveClass(
      'sticky',
      'z-10',
      'max-sm:grid',
      'max-sm:grid-cols-[minmax(0,1fr)_auto]',
      'sm:flex',
      'sm:items-center',
      'sm:gap-2'
    )
    // Row 1: the heading (min-w-0, truncating as a safety) and the
    // Select day button (shrink-0, never clipped) as siblings.
    expect(button.parentElement).toBe(root)
    expect(heading).toHaveClass('max-sm:min-w-0', 'max-sm:truncate')
    expect(button).toHaveClass(
      'shrink-0',
      'max-sm:col-start-2',
      'max-sm:row-start-1'
    )
  })

  it('puts the meta line and the activity chip on row 2 below sm', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({
          activity: {
            id: 'activity-1',
            activityType: 'ride',
            distanceMeters: 64200
          }
        })}
      />
    )

    const meta = screen.getByText('14 · 2 picked')
    const row2 = meta.parentElement?.parentElement
    expect(row2).not.toBeNull()
    // Row 2 spans both grid columns, wraps when needed, and flattens
    // back into the one-row layout at sm and up.
    expect(row2).toHaveClass(
      'max-sm:col-span-2',
      'max-sm:row-start-2',
      'max-sm:flex-wrap',
      'max-sm:min-w-0',
      'sm:contents'
    )
    // The activity chip sits beside the meta on row 2, truncating via
    // min-w-0 when it cannot wrap.
    const phoneChip = screen
      .getAllByText('🚴')
      .map((emoji) => emoji.parentElement)
      .find((chip) => chip?.className.includes('sm:hidden'))
    expect(phoneChip?.parentElement).toBe(row2)
    expect(phoneChip).toHaveClass('sm:hidden', 'min-w-0', 'truncate')
  })

  it('renders no chip when the day has no activity', () => {
    render(<GalleryDayHeader {...baseProps} stats={stats()} />)

    expect(screen.queryByText('🚴')).toBeNull()
  })

  it('labels the button per the action and includes the date in its name', () => {
    render(<GalleryDayHeader {...baseProps} />)

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Select 12 more')
    expect(button).toHaveTextContent('Select 12')
    expect(button).toBeEnabled()
  })

  it('calls onSelectDay with the take', () => {
    const onSelectDay = vi.fn()
    render(<GalleryDayHeader {...baseProps} onSelectDay={onSelectDay} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Select 12 more, Sat 4 Oct 2025' })
    )

    expect(onSelectDay).toHaveBeenCalledWith(DAY, 12)
  })

  it('calls onDeselectDay when every pickable photo is picked', () => {
    const onDeselectDay = vi.fn()
    render(
      <GalleryDayHeader
        {...baseProps}
        picked={14}
        onDeselectDay={onDeselectDay}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Deselect day, Sat 4 Oct 2025' })
    )

    expect(onDeselectDay).toHaveBeenCalledWith(DAY)
  })

  it('keeps All in album focusable and aria-disabled', () => {
    render(
      <GalleryDayHeader
        {...baseProps}
        stats={stats({ count: 8, inAlbum: 8 })}
        hasAlbum
        picked={0}
      />
    )

    const button = screen.getByRole('button', {
      name: 'All in album, Sat 4 Oct 2025'
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveClass(
      'aria-disabled:pointer-events-none',
      'aria-disabled:opacity-50'
    )
  })

  it('keeps Album full focusable and aria-disabled', () => {
    render(<GalleryDayHeader {...baseProps} room={0} />)

    const button = screen.getByRole('button', {
      name: 'Album full, Sat 4 Oct 2025'
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveClass(
      'aria-disabled:pointer-events-none',
      'aria-disabled:opacity-50'
    )
  })

  it('shows the room-left take', () => {
    render(
      <GalleryDayHeader {...baseProps} loadedCount={118} picked={0} room={40} />
    )

    const button = screen.getByRole('button', {
      name: 'Select 40 (room left), Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Select 40 (room left)')
    expect(button).toHaveTextContent('Select 40')
  })

  it('keeps a focused Select day button focused and guarded while busy', () => {
    const onSelectDay = vi.fn()
    const { rerender } = render(
      <GalleryDayHeader {...baseProps} onSelectDay={onSelectDay} />
    )

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    button.focus()

    rerender(
      <GalleryDayHeader
        {...baseProps}
        busyKey={DAY}
        onSelectDay={onSelectDay}
      />
    )

    expect(button).toHaveTextContent('Selecting…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    expect(onSelectDay).not.toHaveBeenCalled()
  })

  it('shows the fetched count while busy once the read has ids', () => {
    render(<GalleryDayHeader {...baseProps} busyKey={DAY} busyCount={2000} />)

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Selecting… 2,000')
    expect(button).not.toHaveTextContent('Select 12 more')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
  })

  it('labels the busy state Deselecting while a Deselect day read runs', () => {
    const { rerender } = render(
      <GalleryDayHeader {...baseProps} picked={14} busyKey={DAY} />
    )

    // Every pickable photo is picked, so the pending action is a deselect.
    const button = screen.getByRole('button', {
      name: 'Deselect day, Sat 4 Oct 2025'
    })
    expect(button).toHaveTextContent('Deselecting…')
    expect(button).not.toHaveTextContent('Selecting…')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()

    rerender(
      <GalleryDayHeader
        {...baseProps}
        picked={14}
        busyKey={DAY}
        busyCount={2000}
      />
    )
    expect(button).toHaveTextContent('Deselecting… 2,000')
    expect(button).not.toHaveTextContent('Selecting…')
  })

  it('disables other days while a day request is busy', () => {
    render(
      <GalleryDayHeader {...baseProps} dayKey="2025-10-03" busyKey={DAY} />
    )

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Fri 3 Oct 2025'
    })
    expect(button).toHaveTextContent('Select 12 more')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
  })

  it('uses native disabled only while the host is saving', () => {
    render(<GalleryDayHeader {...baseProps} disabled />)

    const button = screen.getByRole('button', {
      name: 'Select 12 more, Sat 4 Oct 2025'
    })
    expect(button).toBeDisabled()
    expect(button).not.toHaveAttribute('aria-disabled')
  })

  it('keeps the one-row phone layout when there is no action button', () => {
    const { rerender } = render(
      <GalleryDayHeader {...baseProps} selecting={false} />
    )

    const heading = screen.getByRole('heading')
    const root = heading.parentElement
    expect(root).toHaveClass('flex', 'items-center', 'gap-2')
    expect(root).not.toHaveClass('max-sm:grid')
    expect(heading).not.toHaveClass('max-sm:truncate')

    // The meta line and the activity chip stay flat siblings of the
    // heading, and the meta does not shrink below sm.
    const meta = screen.getByText('14 photos')
    const p = meta.parentElement
    expect(p).toHaveClass('max-sm:shrink-0')
    const row = p?.parentElement
    expect(row).toHaveClass('contents')
    expect(row).not.toHaveClass('max-sm:flex-wrap')

    // The Undated day has no action either, even while selecting.
    rerender(<GalleryDayHeader {...baseProps} dayKey="undated" />)
    expect(screen.getByRole('heading').parentElement).not.toHaveClass(
      'max-sm:grid'
    )
  })

  it('renders no button when not selecting', () => {
    render(<GalleryDayHeader {...baseProps} selecting={false} />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders no button for the undated key', () => {
    render(<GalleryDayHeader {...baseProps} dayKey="undated" />)

    expect(screen.getByRole('heading')).toHaveTextContent('No date')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('passes the host className through', () => {
    render(<GalleryDayHeader {...baseProps} className="top-0 bg-background" />)

    expect(screen.getByRole('heading').parentElement).toHaveClass(
      'top-0',
      'bg-background',
      'sticky',
      'z-10'
    )
  })
})
