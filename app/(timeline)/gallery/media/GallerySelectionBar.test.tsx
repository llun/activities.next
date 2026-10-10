/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { GallerySelectionBar } from './GallerySelectionBar'

const renderBar = (
  props: Partial<React.ComponentProps<typeof GallerySelectionBar>> = {}
) => {
  const handlers = {
    onSelectAllLoaded: vi.fn(),
    onClear: vi.fn(),
    onAddToAlbum: vi.fn(),
    onEditDetails: vi.fn(),
    onPost: vi.fn(),
    onDelete: vi.fn()
  }
  render(
    <GallerySelectionBar count={2} loadedCount={5} {...handlers} {...props} />
  )
  return handlers
}

const button = (name: string) => screen.getByRole('button', { name })

describe('GallerySelectionBar', () => {
  describe('Post and Delete', () => {
    it('act on a selection of photos that are all unposted', () => {
      const handlers = renderBar({ allUnposted: true })

      fireEvent.click(button('Post'))
      fireEvent.click(button('Delete'))

      expect(handlers.onPost).toHaveBeenCalledTimes(1)
      expect(handlers.onDelete).toHaveBeenCalledTimes(1)
      expect(button('Post')).not.toHaveAttribute('aria-disabled')
      expect(button('Delete')).not.toHaveAttribute('aria-disabled')
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).not.toHaveTextContent('Only photos you haven’t posted')
    })

    it('are off, with a reason, when any posted photo is selected', () => {
      const handlers = renderBar({ allUnposted: false })

      fireEvent.click(button('Post'))
      fireEvent.click(button('Delete'))

      expect(handlers.onPost).not.toHaveBeenCalled()
      expect(handlers.onDelete).not.toHaveBeenCalled()
      for (const name of ['Post', 'Delete']) {
        expect(button(name)).toHaveAttribute('aria-disabled', 'true')
        const hintId = button(name).getAttribute('aria-describedby')
        expect(document.getElementById(hintId!)).toHaveTextContent(
          'Only photos you haven’t posted'
        )
      }
    })

    it('are off with nothing selected, and give no reason', () => {
      renderBar({ count: 0, allUnposted: false })

      expect(button('Post')).toHaveAttribute('aria-disabled', 'true')
      expect(button('Delete')).toHaveAttribute('aria-disabled', 'true')
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).not.toHaveTextContent('Only photos')
    })

    it('turns Post off above the instance limit and says so, but not Delete', () => {
      const handlers = renderBar({
        count: 5,
        allUnposted: true,
        maxPostAttachments: 4
      })

      fireEvent.click(button('Post'))

      expect(handlers.onPost).not.toHaveBeenCalled()
      expect(button('Post')).toHaveAttribute('aria-disabled', 'true')
      expect(button('Post').getAttribute('aria-describedby')).toBeTruthy()
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).toHaveTextContent('Up to 4 per post')
      expect(button('Delete')).not.toHaveAttribute('aria-disabled')
    })

    it('allows Post up to the limit', () => {
      const handlers = renderBar({
        count: 4,
        allUnposted: true,
        maxPostAttachments: 4
      })
      fireEvent.click(button('Post'))
      expect(handlers.onPost).toHaveBeenCalledTimes(1)
    })

    it('are left out when the page does not handle them', () => {
      renderBar({ onPost: undefined, onDelete: undefined })
      expect(
        screen.queryByRole('button', { name: 'Post' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Delete' })
      ).not.toBeInTheDocument()
    })
  })

  it('keeps Edit details and Add to album as they were', () => {
    const handlers = renderBar({ allUnposted: false })

    fireEvent.click(button('Edit details'))
    fireEvent.click(button('Add to album'))

    expect(handlers.onEditDetails).toHaveBeenCalledTimes(1)
    expect(handlers.onAddToAlbum).toHaveBeenCalledTimes(1)
  })
})
