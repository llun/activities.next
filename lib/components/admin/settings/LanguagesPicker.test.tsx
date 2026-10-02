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

  it('adds a picked language and closes', () => {
    const { onChange } = openPicker()

    fireEvent.click(screen.getByRole('button', { name: /Deutsch/ }))

    expect(onChange).toHaveBeenCalledWith(['en', 'de'])
    expect(
      screen.queryByRole('textbox', { name: 'Search languages' })
    ).not.toBeInTheDocument()
  })
})
