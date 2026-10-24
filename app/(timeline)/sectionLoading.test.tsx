/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import EmailLoading from './account/email/loading'
import AccountLoading from './account/loading'
import ProfilesLoading from './account/profiles/loading'
import SecurityLoading from './account/security/loading'
import SessionsLoading from './account/sessions/loading'
import VerifyEmailLoading from './account/verify-email/loading'
import AppearanceLoading from './settings/appearance/loading'
import BlocksLoading from './settings/blocks/loading'
import DeleteLoading from './settings/delete/loading'
import FiltersLoading from './settings/filters/loading'
import SettingsLoading from './settings/loading'
import MediaLoading from './settings/media/loading'
import MutesLoading from './settings/mutes/loading'
import NotificationsLoading from './settings/notifications/loading'
import PreferencesLoading from './settings/preferences/loading'
import PrivacyLoading from './settings/privacy/loading'
import ProfileLoading from './settings/profile/loading'
import SidebarLoading from './settings/sidebar/loading'

// Every Settings and Account route draws its final layout while it loads: the
// section headings and frame outlines as shimmer bars, with one polite
// "Loading" for assistive tech and no text on screen.
describe.each([
  ['settings', SettingsLoading],
  ['settings/profile', ProfileLoading],
  ['settings/preferences', PreferencesLoading],
  ['settings/sidebar', SidebarLoading],
  ['settings/appearance', AppearanceLoading],
  ['settings/privacy', PrivacyLoading],
  ['settings/delete', DeleteLoading],
  ['settings/notifications', NotificationsLoading],
  ['settings/filters', FiltersLoading],
  ['settings/blocks', BlocksLoading],
  ['settings/mutes', MutesLoading],
  ['settings/media', MediaLoading],
  ['account', AccountLoading],
  ['account/email', EmailLoading],
  ['account/profiles', ProfilesLoading],
  ['account/security', SecurityLoading],
  ['account/sessions', SessionsLoading],
  ['account/verify-email', VerifyEmailLoading]
])('%s loading', (_route, Loading) => {
  it('draws the page as bars inside frames with one polite Loading', () => {
    const { container } = render(<Loading />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(container.textContent).toBe('Loading')
    expect(
      container.querySelectorAll('[data-slot="frame"]').length
    ).toBeGreaterThan(0)
    expect(
      container.querySelectorAll('[data-slot="skeleton-bar"]').length
    ).toBeGreaterThan(0)
  })
})
