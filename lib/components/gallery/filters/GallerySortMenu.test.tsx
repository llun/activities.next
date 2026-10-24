/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GallerySortMenu } from './GallerySortMenu'
import { GALLERY_SORT_OPTIONS } from './galleryMediaFilterState'

describe('GallerySortMenu', () => {
  it('renders desktop trigger with "Sort: <trigger>" format', () => {
    const { rerender } = render(
      <GallerySortMenu value="taken_desc" onChange={vi.fn()} />
    )
    expect(screen.getByRole('group', { name: 'Sort' })).toHaveTextContent(
      'Sort: Date taken, newest'
    )

    rerender(<GallerySortMenu value="taken_asc" onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Sort' })).toHaveTextContent(
      'Sort: Date taken, oldest'
    )

    rerender(<GallerySortMenu value="uploaded" onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'Sort' })).toHaveTextContent(
      'Sort: Recently uploaded'
    )
  })

  it('renders compact trigger with short label for mobile', () => {
    const { rerender } = render(
      <GallerySortMenu value="taken_desc" onChange={vi.fn()} compact />
    )
    expect(screen.getByRole('group', { name: 'Sort' })).toHaveTextContent(
      'Newest'
    )

    rerender(<GallerySortMenu value="uploaded" onChange={vi.fn()} compact />)
    expect(screen.getByRole('group', { name: 'Sort' })).toHaveTextContent(
      'Uploaded'
    )
  })

  it('lists all sort options and calls onChange on selection', async () => {
    const onChange = vi.fn()
    render(<GallerySortMenu value="taken_desc" onChange={onChange} />)

    const group = screen.getByRole('group', { name: 'Sort' })
    fireEvent.keyDown(group.querySelector('button')!, { key: 'ArrowDown' })

    const menuItems = await screen.findAllByRole('menuitemradio')
    expect(menuItems).toHaveLength(GALLERY_SORT_OPTIONS.length)
    expect(menuItems[0]).toHaveAttribute('aria-checked', 'true')
    expect(menuItems[1]).toHaveAttribute('aria-checked', 'false')

    const oldestItem = await screen.findByRole('menuitemradio', {
      name: /Date taken, oldest first/
    })
    expect(oldestItem).toBeInTheDocument()

    fireEvent.click(oldestItem)
    expect(onChange).toHaveBeenCalledWith('taken_asc')
  })
})
