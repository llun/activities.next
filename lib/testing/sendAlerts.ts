import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'

// Alerts of their own: the save line under the text area, and the note that
// offers the text of a draft that could not be kept.
const DRAFT_ALERTS = ['Not saved, copy your text', 'Couldn’t save to Drafts']

/** The composer's send alerts, without the drafts' own alerts. */
export const sendAlerts = () =>
  screen
    .queryAllByRole('alert')
    .filter(
      (alert) => !DRAFT_ALERTS.some((text) => alert.textContent?.includes(text))
    )

export const findSendAlert = () =>
  waitFor(() => {
    const [alert] = sendAlerts()
    expect(alert).toBeDefined()
    return alert
  })
