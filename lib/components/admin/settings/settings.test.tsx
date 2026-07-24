/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { EnvLockBadge } from './EnvLockBadge'
import { LanguagesPicker } from './LanguagesPicker'
import { SettingsField } from './SettingsField'

describe('EnvLockBadge', () => {
  it('names the pinning variable in its tooltip', () => {
    render(<EnvLockBadge envVar="ACTIVITIES_SERVICE_NAME" />)
    const badge = screen.getByText('Set by environment')
    expect(badge).toHaveAttribute('title', 'ACTIVITIES_SERVICE_NAME')
  })
})

describe('SettingsField', () => {
  it('shows the help text when unlocked', () => {
    render(
      <SettingsField label="Instance name" help="Shown on the about page.">
        <input />
      </SettingsField>
    )
    expect(screen.getByText('Shown on the about page.')).toBeInTheDocument()
    expect(screen.queryByText('Set by environment')).not.toBeInTheDocument()
  })

  it('shows the env badge and pinned help when locked', () => {
    render(
      <SettingsField
        label="Instance name"
        help="Shown on the about page."
        locked
        envVar="ACTIVITIES_SERVICE_NAME"
      >
        <input />
      </SettingsField>
    )
    expect(screen.getByText('Set by environment')).toBeInTheDocument()
    expect(screen.getByText('ACTIVITIES_SERVICE_NAME')).toBeInTheDocument()
    // The locked help replaces the normal help.
    expect(
      screen.queryByText('Shown on the about page.')
    ).not.toBeInTheDocument()
  })
})

describe('LanguagesPicker', () => {
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

  it('adds a language through the searchable picker', () => {
    const onChange = vi.fn()
    render(<LanguagesPicker value={['en']} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /add language/i }))
    fireEvent.change(screen.getByPlaceholderText('Search languages'), {
      target: { value: 'deutsch' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Deutsch/ }))

    expect(onChange).toHaveBeenCalledWith(['en', 'de'])
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
