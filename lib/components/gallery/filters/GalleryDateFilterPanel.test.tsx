/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { GalleryMonthFacet } from '@/lib/services/gallery/galleryEntities'

import { GalleryDateFilterPanel } from './GalleryDateFilterPanel'

describe('GalleryDateFilterPanel', () => {
  const sampleMonths: GalleryMonthFacet[] = [
    { month: '2025-10', count: 12 },
    { month: '2025-09', count: 8 },
    { month: '2024-12', count: 15 },
    { month: '2024-05', count: 5 }
  ]

  it('renders presets and aggregated year counts', () => {
    render(
      <GalleryDateFilterPanel
        value={null}
        months={sampleMonths}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Any time/ })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /This month/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /This year/ })
    ).toBeInTheDocument()

    // 2025 sum = 12 + 8 = 20
    const year2025 = screen.getByRole('button', { name: /^2025/ })
    expect(year2025).toHaveTextContent('20')

    // 2024 sum = 15 + 5 = 20
    const year2024 = screen.getByRole('button', { name: /^2024/ })
    expect(year2024).toHaveTextContent('20')
  })

  it('renders individual months with formatted names and counts', () => {
    render(
      <GalleryDateFilterPanel
        value={null}
        months={sampleMonths}
        onSelect={vi.fn()}
      />
    )

    const oct2025 = screen.getByRole('button', { name: /October 2025/ })
    expect(oct2025).toBeInTheDocument()
    expect(oct2025).toHaveTextContent('12')

    const sep2025 = screen.getByRole('button', { name: /September 2025/ })
    expect(sep2025).toBeInTheDocument()
    expect(sep2025).toHaveTextContent('8')

    const dec2024 = screen.getByRole('button', { name: /December 2024/ })
    expect(dec2024).toBeInTheDocument()
    expect(dec2024).toHaveTextContent('15')
  })

  it('calls onSelect with correct payloads for presets, years, and months', () => {
    const onSelect = vi.fn()
    render(
      <GalleryDateFilterPanel
        value={null}
        months={sampleMonths}
        onSelect={onSelect}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Any time/ }))
    expect(onSelect).toHaveBeenLastCalledWith(null)

    fireEvent.click(screen.getByRole('button', { name: /This month/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'this_month' })

    fireEvent.click(screen.getByRole('button', { name: /This year/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'this_year' })

    fireEvent.click(screen.getByRole('button', { name: /^2025/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'year', year: 2025 })

    fireEvent.click(screen.getByRole('button', { name: /October 2025/ }))
    expect(onSelect).toHaveBeenLastCalledWith({
      kind: 'month',
      month: '2025-10'
    })
  })

  it('reflects active preset, year, or month option', () => {
    const { rerender } = render(
      <GalleryDateFilterPanel
        value={null}
        months={sampleMonths}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Any time/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    rerender(
      <GalleryDateFilterPanel
        value={{ kind: 'year', year: 2024 }}
        months={sampleMonths}
        onSelect={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /^2024/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: /Any time/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )

    rerender(
      <GalleryDateFilterPanel
        value={{ kind: 'month', month: '2025-09' }}
        months={sampleMonths}
        onSelect={vi.fn()}
      />
    )
    expect(
      screen.getByRole('button', { name: /September 2025/ })
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('handles custom date range inputs and apply button', () => {
    const onSelect = vi.fn()
    render(
      <GalleryDateFilterPanel
        value={null}
        months={sampleMonths}
        onSelect={onSelect}
      />
    )

    const fromInput = screen.getByLabelText('From')
    const toInput = screen.getByLabelText('To')
    const applyButton = screen.getByRole('button', { name: 'Apply' })

    fireEvent.change(fromInput, { target: { value: '2025-06-01' } })
    fireEvent.change(toInput, { target: { value: '2025-06-30' } })
    fireEvent.click(applyButton)

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'custom',
      from: '2025-06-01',
      to: '2025-06-30'
    })
  })

  it('applies custom range when Enter is pressed in date inputs', () => {
    const onSelect = vi.fn()
    render(
      <GalleryDateFilterPanel
        value={null}
        months={sampleMonths}
        onSelect={onSelect}
      />
    )

    const fromInput = screen.getByLabelText('From')
    fireEvent.change(fromInput, { target: { value: '2025-01-01' } })
    fireEvent.keyDown(fromInput, { key: 'Enter' })

    expect(onSelect).toHaveBeenCalledWith({
      kind: 'custom',
      from: '2025-01-01',
      to: ''
    })
  })

  it('clears filter when Apply is clicked with empty custom inputs', () => {
    const onSelect = vi.fn()
    render(
      <GalleryDateFilterPanel
        value={{ kind: 'custom', from: '', to: '' }}
        months={sampleMonths}
        onSelect={onSelect}
      />
    )

    const applyButton = screen.getByRole('button', { name: 'Apply' })
    fireEvent.click(applyButton)

    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('blocks Apply with a message when the custom range is inverted', () => {
    const onSelect = vi.fn()
    render(
      <GalleryDateFilterPanel value={null} months={[]} onSelect={onSelect} />
    )
    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2025-06-10' }
    })
    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2025-06-01' }
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/on or before/)
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('To'), { key: 'Enter' })
    expect(onSelect).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2025-06-10' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'custom',
      from: '2025-06-10',
      to: '2025-06-10'
    })
  })
})
