/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { GalleryGridSkeleton } from './GalleryGridSkeleton'

describe('GalleryGridSkeleton', () => {
  it('draws the requested number of tiles, hidden from assistive tech', () => {
    const { container } = render(<GalleryGridSkeleton tiles={5} />)

    const tiles = container.querySelectorAll('[aria-hidden="true"]')
    expect(tiles).toHaveLength(5)
  })

  it('is silent without a label, so a screen that announces itself says it once', () => {
    render(<GalleryGridSkeleton />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces its label as one polite status', () => {
    render(<GalleryGridSkeleton label="Loading photos" />)

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Loading photos')
  })
})
