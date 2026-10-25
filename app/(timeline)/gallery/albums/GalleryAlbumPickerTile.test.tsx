/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'

import { GalleryAlbumPickerTile } from '@/app/(timeline)/gallery/albums/GalleryAlbumPickerTile'
import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'

describe('GalleryAlbumPickerTile', () => {
  it('renders the caption and includes it in the button name when showCaption is true', () => {
    const item = buildGalleryItem('1', {
      subject: { name: 'Common kingfisher' } as never,
      takenAt: '2026-09-12T10:00:00Z'
    })
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        showCaption
        onToggle={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', {
        name: 'Select Common kingfisher, photo 1, Common kingfisher · 12 Sep 2026'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Common kingfisher · 12 Sep 2026')
    ).toBeInTheDocument()
  })

  it('renders "Uploaded <date>" for a dateless photo when showCaption is true', () => {
    const item = buildGalleryItem('1', {
      takenAt: null,
      uploadedAt: '2025-10-03T10:00:00Z'
    })
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        showCaption
        onToggle={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', {
        name: 'Select Photo 1, Uploaded 3 Oct 2025'
      })
    ).toBeInTheDocument()
    expect(screen.getByText('Uploaded 3 Oct 2025')).toBeInTheDocument()
  })

  it('keeps the accessible name unchanged as "Select Photo 1" when showCaption is false or omitted', () => {
    const item = buildGalleryItem('1', {
      subject: { name: 'Common kingfisher' } as never,
      takenAt: '2026-09-12T10:00:00Z'
    })
    const { unmount } = render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        onToggle={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Select Common kingfisher, photo 1' })
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Common kingfisher · 12 Sep 2026')
    ).not.toBeInTheDocument()
    unmount()

    const unnamed = buildGalleryItem('1')
    render(
      <GalleryAlbumPickerTile
        item={unnamed}
        index={0}
        isSelected={false}
        onToggle={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: 'Select Photo 1' })
    ).toBeInTheDocument()
  })

  it('shows the "Not in gallery" pill when inGallery is false and includes its words in the name', () => {
    const item = buildGalleryItem('1', { inGallery: false })
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('Not in gallery')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Select Photo 1, not in gallery'
      })
    ).toBeInTheDocument()
  })

  it('hides the "Not in gallery" words on phones but keeps the icon', () => {
    const { container } = render(
      <GalleryAlbumPickerTile
        item={buildGalleryItem('1', { inGallery: false })}
        index={0}
        isSelected={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('Not in gallery')).toHaveClass('max-sm:hidden')
    expect(container.querySelector('svg.lucide-eye-off')).toBeInTheDocument()
  })

  it('shows the "In 2 albums" badge when albumCount is 2 and includes it in the name', () => {
    const item = buildGalleryItem('1', { albumCount: 2 })
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Select Photo 1, in 2 albums'
      })
    ).toBeInTheDocument()
  })

  it('shows "In album" (not "Not in gallery") when isMember, has aria-disabled and ends with ", already in the album"', () => {
    const item = buildGalleryItem('1', { inGallery: false })
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        isMember
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('In album')).toBeInTheDocument()
    expect(screen.queryByText('Not in gallery')).not.toBeInTheDocument()
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button.getAttribute('aria-label')).toMatch(/, already in the album$/)
    expect(
      screen.getByRole('button', {
        name: 'Photo 1, not in gallery, already in the album'
      })
    ).toBeInTheDocument()
  })

  it('keeps isMember and isBlocked tiles focusable with aria-disabled="true" and ignores click/Space', () => {
    const item = buildGalleryItem('1')
    const onToggle = vi.fn()
    const { rerender } = render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        isMember
        onToggle={onToggle}
      />
    )
    const memberButton = screen.getByRole('button')
    expect(memberButton).toHaveAttribute('aria-disabled', 'true')
    expect(memberButton).not.toBeDisabled()
    fireEvent.click(memberButton)
    fireEvent.keyDown(memberButton, { key: ' ' })
    expect(onToggle).not.toHaveBeenCalled()

    rerender(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        isBlocked
        onToggle={onToggle}
      />
    )
    const blockedButton = screen.getByRole('button')
    expect(blockedButton).toHaveAttribute('aria-disabled', 'true')
    expect(blockedButton).not.toBeDisabled()
    fireEvent.click(blockedButton)
    fireEvent.keyDown(blockedButton, { key: ' ' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('lets Shift activation through on member and blocked tiles while plain activation stays ignored', () => {
    const item = buildGalleryItem('1')
    const onToggle = vi.fn()
    const { rerender } = render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        isMember
        onToggle={onToggle}
      />
    )
    const memberButton = screen.getByRole('button')

    // Plain click and Space still do nothing on a member tile.
    fireEvent.click(memberButton)
    fireEvent.keyDown(memberButton, { key: ' ' })
    expect(onToggle).not.toHaveBeenCalled()

    // Shift-modified activation reaches the host so a range ending on the
    // tile can apply up to it.
    fireEvent.click(memberButton, { shiftKey: true })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: true })
    fireEvent.keyDown(memberButton, { key: ' ', shiftKey: true })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: true })
    expect(onToggle).toHaveBeenCalledTimes(2)

    rerender(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        isBlocked
        onToggle={onToggle}
      />
    )
    const blockedButton = screen.getByRole('button')

    fireEvent.click(blockedButton)
    fireEvent.keyDown(blockedButton, { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(2)

    fireEvent.click(blockedButton, { shiftKey: true })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: true })
    fireEvent.keyDown(blockedButton, { key: ' ', shiftKey: true })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: true })
    expect(onToggle).toHaveBeenCalledTimes(4)

    // A disabled host still swallows every activation, shift included.
    rerender(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        isBlocked
        disabled
        onToggle={onToggle}
      />
    )
    const disabledButton = screen.getByRole('button')
    fireEvent.click(disabledButton, { shiftKey: true })
    fireEvent.keyDown(disabledButton, { key: ' ', shiftKey: true })
    expect(onToggle).toHaveBeenCalledTimes(4)
  })

  it('sets disabled={true} on the button only when disabled prop is true', () => {
    const item = buildGalleryItem('1')
    const onToggle = vi.fn()
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        disabled
        onToggle={onToggle}
      />
    )
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    fireEvent.click(button)
    fireEvent.keyDown(button, { key: ' ' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('applies the anchor ring class when isAnchor is true, selected or not', () => {
    const item = buildGalleryItem('1')
    const { rerender } = render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        isAnchor
        onToggle={vi.fn()}
      />
    )
    const button = screen.getByRole('button')
    expect(button).toHaveClass(
      'ring-2 ring-foreground ring-offset-2 ring-offset-background'
    )
    expect(button).not.toHaveClass('inset-ring-primary')

    rerender(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={true}
        isAnchor
        onToggle={vi.fn()}
      />
    )
    expect(button).toHaveClass('inset-ring-primary inset-ring-2')
    expect(button).toHaveClass(
      'ring-2 ring-foreground ring-offset-2 ring-offset-background'
    )
  })

  it('draws the focus outline outside the tile, clear of the pick ring', () => {
    const item = buildGalleryItem('1')
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected
        onToggle={vi.fn()}
      />
    )
    const button = screen.getByRole('button')
    expect(button).toHaveClass(
      'focus-visible:outline-foreground',
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2'
    )
    expect(button).not.toHaveClass('focus-visible:outline-primary')
    expect(button).not.toHaveClass('focus-visible:-outline-offset-2')
  })

  it('omits date from visible caption but includes getPickerTileDate in aria-label when showCaptionDate is false', () => {
    const item = buildGalleryItem('1', {
      subject: { name: 'Common kingfisher' } as never,
      takenAt: '2026-09-12T10:00:00Z'
    })
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        showCaption
        showCaptionDate={false}
        onToggle={vi.fn()}
      />
    )
    expect(screen.getByText('Common kingfisher')).toBeInTheDocument()
    expect(
      screen.queryByText('Common kingfisher · 12 Sep 2026')
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'Select Common kingfisher, photo 1, taken 12 Sep 2026'
      })
    ).toBeInTheDocument()
  })

  it('passes shiftKey to onToggle on click and Space keydown', () => {
    const item = buildGalleryItem('1')
    const onToggle = vi.fn()
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={0}
        isSelected={false}
        onToggle={onToggle}
      />
    )
    const button = screen.getByRole('button')

    fireEvent.click(button, { shiftKey: true })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: true })

    fireEvent.click(button, { shiftKey: false })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: false })

    fireEvent.keyDown(button, { key: ' ', shiftKey: false })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: false })

    fireEvent.keyDown(button, { key: ' ', shiftKey: true })
    expect(onToggle).toHaveBeenLastCalledWith('1', { shiftKey: true })
  })

  it.each([false, true])(
    'ignores repeated Space keydown and cancels native keyup click (shift=%s)',
    (shiftKey) => {
      const item = buildGalleryItem('1')
      const onToggle = vi.fn()
      render(
        <GalleryAlbumPickerTile
          item={item}
          index={0}
          isSelected={false}
          onToggle={onToggle}
        />
      )
      const button = screen.getByRole('button')

      fireEvent.keyDown(button, { key: ' ', shiftKey, repeat: false })
      fireEvent.keyDown(button, { key: ' ', shiftKey, repeat: true })
      const keyUp = createEvent.keyUp(button, { key: ' ', shiftKey })
      fireEvent(button, keyUp)

      expect(keyUp.defaultPrevented).toBe(true)
      expect(onToggle).toHaveBeenCalledTimes(1)
      expect(onToggle).toHaveBeenCalledWith('1', { shiftKey })
    }
  )

  it('renders data-grid-index, tabIndex, onFocus, and scroll-mt-12 on the button', () => {
    const item = buildGalleryItem('1')
    const onFocus = vi.fn()
    render(
      <GalleryAlbumPickerTile
        item={item}
        index={3}
        isSelected={false}
        tabIndex={0}
        onFocus={onFocus}
        onToggle={vi.fn()}
      />
    )
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('data-grid-index', '3')
    expect(button).toHaveAttribute('tabindex', '0')
    expect(button).toHaveClass('scroll-mt-12')
    fireEvent.focus(button)
    expect(onFocus).toHaveBeenCalledTimes(1)
  })
})
