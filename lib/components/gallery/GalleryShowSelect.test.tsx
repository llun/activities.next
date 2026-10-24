/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { GALLERY_SHOW_OPTIONS, GalleryShowSelect } from './GalleryShowSelect'

describe('GalleryShowSelect', () => {
  it('renders the active selection in the trigger', () => {
    render(<GalleryShowSelect value="all" onChange={vi.fn()} />)

    expect(screen.getByRole('group', { name: 'Show' })).toHaveTextContent(
      'Show Everything'
    )
  })

  it('lists all options including "Not in any album" with hints and calls onChange on select', async () => {
    const onChange = vi.fn()
    render(<GalleryShowSelect value="all" onChange={onChange} />)

    const group = screen.getByRole('group', { name: 'Show' })
    fireEvent.keyDown(group.querySelector('button')!, { key: 'ArrowDown' })

    const menuItems = await screen.findAllByRole('menuitem')
    expect(menuItems).toHaveLength(GALLERY_SHOW_OPTIONS.length)

    const notInAlbum = await screen.findByRole('menuitem', {
      name: /^Not in any album/
    })
    expect(notInAlbum).toHaveTextContent('Photos you haven’t filed yet')

    fireEvent.click(notInAlbum)
    expect(onChange).toHaveBeenCalledWith('not_in_album')
  })
})
