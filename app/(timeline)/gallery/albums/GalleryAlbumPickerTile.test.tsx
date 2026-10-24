/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

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

  it('shows "In album" (not "Not in gallery") when isMember, is disabled, and ends with ", already in the album"', () => {
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
    expect(button).toBeDisabled()
    expect(button.getAttribute('aria-label')).toMatch(/, already in the album$/)
    expect(
      screen.getByRole('button', {
        name: 'Photo 1, not in gallery, already in the album'
      })
    ).toBeInTheDocument()
  })
})
