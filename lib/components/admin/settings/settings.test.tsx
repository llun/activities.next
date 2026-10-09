/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { EnvLockBadge } from './EnvLockBadge'
import { ControlRow, SettingsField } from './SettingsField'

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

describe('SettingsField label and hint', () => {
  it('names the control by its label and describes it by the help text', () => {
    render(
      <SettingsField
        label="Instance name"
        htmlFor="name"
        help="Shown on the about page."
      >
        <input id="name" />
      </SettingsField>
    )
    expect(screen.getByLabelText('Instance name')).toHaveAccessibleDescription(
      'Shown on the about page.'
    )
  })

  it('describes the control by the env-lock explanation when it is pinned', () => {
    render(
      <SettingsField
        label="Instance name"
        htmlFor="name"
        locked
        envVar="ACTIVITIES_SERVICE_NAME"
      >
        <input id="name" />
      </SettingsField>
    )
    expect(screen.getByLabelText('Instance name')).toHaveAccessibleDescription(
      /ACTIVITIES_SERVICE_NAME/
    )
  })

  it('leaves a control that brings its own description alone', () => {
    render(
      <>
        <p id="mine">My own description.</p>
        <SettingsField label="Instance name" htmlFor="name" help="Hint.">
          <input id="name" aria-describedby="mine" />
        </SettingsField>
      </>
    )
    expect(screen.getByLabelText('Instance name')).toHaveAccessibleDescription(
      'My own description.'
    )
  })

  it('keeps the control name exact when the field is locked', () => {
    render(
      <SettingsField
        label="Instance name"
        htmlFor="name"
        locked
        envVar="ACTIVITIES_SERVICE_NAME"
      >
        <input id="name" />
      </SettingsField>
    )
    expect(screen.getByLabelText('Instance name')).toBeInTheDocument()
  })
})

describe('ControlRow', () => {
  it('labels a switch with the row label and shows its description', () => {
    render(
      <ControlRow
        label="Fetch link previews"
        htmlFor="previews"
        description="Looks up titles and images for links."
      >
        <button role="switch" id="previews" aria-checked="true" />
      </ControlRow>
    )
    expect(
      screen.getByRole('switch', { name: 'Fetch link previews' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Looks up titles and images for links.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'Fetch link previews' })
    ).toHaveAccessibleDescription('Looks up titles and images for links.')
  })

  it('keeps the description and adds the env badge and pinned line below it when locked', () => {
    render(
      <ControlRow
        label="Fetch link previews"
        htmlFor="previews"
        description="Looks up titles."
        locked
        envVar="ACTIVITIES_LINK_PREVIEWS"
      >
        <button role="switch" id="previews" aria-checked="true" />
      </ControlRow>
    )
    expect(screen.getByText('Set by environment')).toBeInTheDocument()
    expect(screen.getByText('Looks up titles.')).toBeInTheDocument()
    const description = screen.getByRole('switch', {
      name: 'Fetch link previews'
    })
    expect(description).toHaveAccessibleDescription(/Looks up titles\./)
    expect(description).toHaveAccessibleDescription(/ACTIVITIES_LINK_PREVIEWS/)
  })
})
