/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { LanguagesPicker } from './LanguagesPicker'

describe('LanguagesPicker', () => {
  const openPicker = () => {
    const onChange = vi.fn()
    render(<LanguagesPicker value={['en']} onChange={onChange} />)
    const add = screen.getByRole('button', { name: /Add language/ })
    fireEvent.click(add)
    return { add, onChange }
  }

  it('draws the Add language chip with the input-coloured dashed border', () => {
    render(<LanguagesPicker value={['en']} onChange={vi.fn()} />)

    // `border-input`, not the default border colour: in dark mode the design's
    // dashed border is #3D3D3D, a step lighter than the panel's #2E2E2E.
    expect(screen.getByRole('button', { name: /Add language/ })).toHaveClass(
      'border-dashed',
      'border-input'
    )
  })

  it('opens the panel 4 px below the 30 px chip row', () => {
    openPicker()

    const panel = screen
      .getByRole('textbox', { name: 'Search languages' })
      .closest('.absolute') as HTMLElement
    expect(panel).toHaveClass('top-[34px]', 'w-60')
  })

  it('insets the search text to the design: 10 px padding, a 14 px glyph, a 16 px gap', () => {
    openPicker()

    // Panel border 1 + padding 8 + px-2.5 10 + glyph 14 + gap 16 puts the
    // placeholder 49 px from the panel's left edge, as the board draws it.
    const field = screen.getByRole('textbox', { name: 'Search languages' })
      .parentElement as HTMLElement
    expect(field).toHaveClass('gap-4', 'px-2.5')
    const glyph = field.querySelector('svg') as SVGElement
    expect(glyph).toHaveClass('h-3.5', 'w-3.5', 'shrink-0')
  })

  it('adds a language through the searchable picker and closes', () => {
    const { onChange } = openPicker()

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search languages' }),
      {
        target: { value: 'deutsch' }
      }
    )
    fireEvent.click(screen.getByRole('button', { name: /Deutsch/ }))

    expect(onChange).toHaveBeenCalledWith(['en', 'de'])
    expect(
      screen.queryByRole('textbox', { name: 'Search languages' })
    ).not.toBeInTheDocument()
  })

  it('renders a chip per selected language', () => {
    render(<LanguagesPicker value={['en', 'th']} onChange={vi.fn()} />)
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('ไทย')).toBeInTheDocument()
  })

  it('keeps the chip label on Primary Text and the remove glyph on the brand orange', () => {
    render(<LanguagesPicker value={['en']} onChange={vi.fn()} />)
    const chip = screen.getByText('English')
    expect(chip).toHaveClass('text-primary-text')
    const glyph = screen
      .getByRole('button', { name: 'Remove English' })
      .querySelector('svg')
    expect(glyph).toHaveClass('text-primary')
  })

  it('removes a language via its chip button', () => {
    const onChange = vi.fn()
    render(<LanguagesPicker value={['en', 'th']} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove English' }))
    expect(onChange).toHaveBeenCalledWith(['th'])
  })

  it('hides the add and remove controls when disabled', () => {
    render(<LanguagesPicker value={['en']} onChange={vi.fn()} disabled />)
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /add language/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Remove English' })
    ).not.toBeInTheDocument()
  })
})
