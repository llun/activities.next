/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  createMockAnnounce,
  createMockNote
} from './__fixtures__/timeline-context'
import { BoostCarousel } from './boost-carousel'

describe('BoostCarousel', () => {
  it('renders nothing when statuses array is empty', () => {
    const { container } = render(<BoostCarousel statuses={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders boost cards and count', () => {
    const original = createMockNote({ id: 'orig-1', text: 'Original text' })
    const boost1 = createMockAnnounce({
      id: 'boost-1',
      originalStatus: original
    })
    const boost2 = createMockAnnounce({
      id: 'boost-2',
      originalStatus: original
    })

    render(<BoostCarousel statuses={[boost1, boost2]} />)
    expect(screen.getByText('Boosts (2)')).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Boosts carousel' })
    ).toBeInTheDocument()
  })

  it('navigates via previous and next buttons', () => {
    const original = createMockNote({ id: 'orig-1', text: 'Original text' })
    const boost1 = createMockAnnounce({
      id: 'boost-1',
      originalStatus: original
    })
    render(<BoostCarousel statuses={[boost1]} />)

    const prevBtn = screen.getByRole('button', { name: 'Previous boosts' })
    const nextBtn = screen.getByRole('button', { name: 'Next boosts' })

    const region = screen.getByRole('region', { name: 'Boosts carousel' })
    const scrollBySpy = vi.fn()
    region.scrollBy = scrollBySpy

    fireEvent.click(nextBtn)
    expect(scrollBySpy).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' })

    fireEvent.click(prevBtn)
    expect(scrollBySpy).toHaveBeenCalledWith({ left: -300, behavior: 'smooth' })
  })
})
