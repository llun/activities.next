/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DraftSaveStatus } from './DraftSaveStatus'

describe('DraftSaveStatus', () => {
  it('says Saving and Saved without announcing them', () => {
    const { rerender, container } = render(
      <DraftSaveStatus saveState="saving" text="hi" />
    )
    expect(screen.getByText('Saving…')).toBeVisible()

    rerender(<DraftSaveStatus saveState="saved" text="hi" />)
    expect(screen.getByText('Saved on this device')).toBeVisible()
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('announces only the failure, and copies the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const { rerender } = render(
      <DraftSaveStatus saveState="saving" text="my words" />
    )
    const saving = screen.getByText('Saving…')
    rerender(<DraftSaveStatus saveState="error" text="my words" />)

    // A new alert element, not the Saving line turned into one: only an
    // inserted alert is reliably announced.
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Not saved, copy your text')
    expect(alert).not.toBe(saving)
    expect(saving).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('my words'))
    expect(
      await screen.findByRole('button', { name: 'Copied' })
    ).toBeInTheDocument()
  })
})
