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

  it('opens a search box when Add language is pressed', () => {
    openPicker()

    expect(
      screen.getByRole('textbox', { name: 'Search languages' })
    ).toHaveFocus()
  })

  it('only offers languages that are not already picked', () => {
    openPicker()

    expect(screen.queryByRole('button', { name: /^English/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Deutsch/ })).toBeInTheDocument()
  })

  it('says so when the search matches nothing', () => {
    openPicker()

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search languages' }),
      { target: { value: 'zzzz' } }
    )

    expect(screen.getByText('No matches')).toBeInTheDocument()
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
