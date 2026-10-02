/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { EnvLockBadge } from './EnvLockBadge'
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
