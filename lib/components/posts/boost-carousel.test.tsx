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
