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
    onRetryLoading: vi.fn(),
    onPost: vi.fn(),
    onDelete: vi.fn()
  }
  render(
    <GallerySelectionBar
      count={2}
      loadedCount={5}
      loadedSelectedCount={2}
      {...handlers}
      {...props}
    />
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

  describe('Add to album', () => {
    it('is enabled for any selection, including hidden-only, with no hidden hint', () => {
      const handlers = renderBar({
        count: 3,
        loadedCount: 5,
        loadedSelectedCount: 3
      })

      expect(button('Add to album')).not.toHaveAttribute('aria-disabled')
      expect(
        screen.getByRole('region', { name: 'Selection' })
      ).not.toHaveTextContent('hidden')

      fireEvent.click(button('Add to album'))
      expect(handlers.onAddToAlbum).toHaveBeenCalledTimes(1)
    })

    it('is disabled when count is 0', () => {
      renderBar({ count: 0, loadedCount: 5, loadedSelectedCount: 0 })
      expect(button('Add to album')).toHaveAttribute('aria-disabled', 'true')
    })
  })

  it('disables entity actions but keeps Add enabled while photos hydrate', () => {
    const handlers = renderBar({
      count: 4,
      actionCount: 2,
      allUnposted: true,
      selectionIncomplete: true,
      hydrationPending: true,
      hydrationMessage: 'Loading 2 selected photos…'
    })

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading 2 selected photos…'
    )
    for (const name of ['Edit details', 'Post', 'Delete']) {
      fireEvent.click(button(name))
      expect(button(name)).toHaveAttribute('aria-disabled', 'true')
    }
    expect(handlers.onEditDetails).not.toHaveBeenCalled()
    expect(button('Add to album')).not.toHaveAttribute('aria-disabled')
    fireEvent.click(button('Add to album'))
    expect(handlers.onAddToAlbum).toHaveBeenCalledOnce()
    expect(handlers.onPost).not.toHaveBeenCalled()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('keeps entity actions disabled after short hydration and offers Retry loading', () => {
    const handlers = renderBar({
      count: 4,
      actionCount: 2,
      allUnposted: true,
      maxPostAttachments: 2,
      selectionIncomplete: true,
      hydrationMessage: "Some selected photos couldn't be loaded"
    })

    fireEvent.click(button('Edit details'))
    fireEvent.click(button('Add to album'))
    fireEvent.click(button('Post'))
    fireEvent.click(button('Delete'))
    fireEvent.click(button('Retry loading'))

    expect(screen.getByRole('status')).toHaveTextContent(
      "Some selected photos couldn't be loaded"
    )
    expect(button('Edit details')).toHaveAttribute('aria-disabled', 'true')
    expect(button('Post')).toHaveAttribute('aria-disabled', 'true')
    expect(button('Delete')).toHaveAttribute('aria-disabled', 'true')
    expect(button('Add to album')).not.toHaveAttribute('aria-disabled')
    expect(handlers.onEditDetails).not.toHaveBeenCalled()
    expect(handlers.onAddToAlbum).toHaveBeenCalledOnce()
    expect(handlers.onPost).not.toHaveBeenCalled()
    expect(handlers.onDelete).not.toHaveBeenCalled()
    expect(handlers.onRetryLoading).toHaveBeenCalledOnce()
  })

  describe('Select all loaded', () => {
    it('is aria-disabled only when every loaded photo is selected', () => {
      renderBar({ count: 5, loadedCount: 3, loadedSelectedCount: 3 })
      expect(button('Select all loaded')).toHaveAttribute(
        'aria-disabled',
        'true'
      )
    })

    it('is enabled when count > loadedCount but not all loaded photos are selected', () => {
      const handlers = renderBar({
        count: 5,
        loadedCount: 3,
        loadedSelectedCount: 2
      })
      expect(button('Select all loaded')).not.toHaveAttribute('aria-disabled')

      fireEvent.click(button('Select all loaded'))
      expect(handlers.onSelectAllLoaded).toHaveBeenCalledTimes(1)
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
