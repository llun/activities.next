/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { GalleryAlbumSpeciesFilter } from './GalleryAlbumSpeciesFilter'

const species = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    key: `name:s${index + 1}`,
    name: `Species ${index + 1}`,
    count: index + 1
  }))

describe('GalleryAlbumSpeciesFilter', () => {
  it('shows All with the total, then a chip per species', () => {
    render(
      <GalleryAlbumSpeciesFilter
        species={species(2)}
        total={9}
        subject={null}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /^All\s*9$/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(
      screen.getByRole('button', { name: /^Species 1\s*1$/ })
    ).toHaveAttribute('aria-pressed', 'false')
    expect(
      screen.queryByRole('button', { name: /^\+/ })
    ).not.toBeInTheDocument()
  })

  it('reports the chosen species key, and null for All', () => {
    const onChange = vi.fn()
    render(
      <GalleryAlbumSpeciesFilter
        species={species(2)}
        total={9}
        subject="name:s2"
        onChange={onChange}
      />
    )

    expect(
      screen.getByRole('button', { name: /^Species 2\s*2$/ })
    ).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /^Species 1\s*1$/ }))
    fireEvent.click(screen.getByRole('button', { name: /^All\s*9$/ }))

    expect(onChange).toHaveBeenNthCalledWith(1, 'name:s1')
    expect(onChange).toHaveBeenNthCalledWith(2, null)
  })

  it('keeps the first five and folds the rest behind a +N that toggles', () => {
    render(
      <GalleryAlbumSpeciesFilter
        species={species(7)}
        total={28}
        subject={null}
        onChange={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: /Species 6/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '+2' }))
    expect(
      screen.getByRole('button', { name: /Species 7/ })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fewer' }))
    expect(screen.queryByRole('button', { name: /Species 6/ })).toBeNull()
  })
})
