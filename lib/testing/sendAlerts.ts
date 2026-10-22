import { screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'

/**
 * The composer's send alerts. The save line under the text area ("Not saved,
 * copy your text") is an alert of its own, so it is left out.
 */
export const sendAlerts = () =>
  screen
    .queryAllByRole('alert')
    .filter(
      (alert) => !alert.textContent?.includes('Not saved, copy your text')
    )

export const findSendAlert = () =>
  waitFor(() => {
    const [alert] = sendAlerts()
    expect(alert).toBeDefined()
    return alert
  })
