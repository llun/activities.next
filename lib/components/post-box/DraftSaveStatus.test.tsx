/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { DraftSaveStatus } from './DraftSaveStatus'

describe('DraftSaveStatus', () => {
  it('shows nothing while idle', () => {
    const { container } = render(<DraftSaveStatus saveState="idle" text="" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('says Saving and Saved without announcing them', () => {
    const { rerender, container } = render(
      <DraftSaveStatus saveState="saving" text="hi" />
    )
    expect(screen.getByText('Saving…')).toBeVisible()

    rerender(<DraftSaveStatus saveState="saved" text="hi" />)
    expect(screen.getByText('Saved on this device')).toBeVisible()
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('announces only the failure, and copies the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })
    const { container } = render(
      <DraftSaveStatus saveState="error" text="my words" />
    )

    expect(screen.getByText('Not saved, copy your text')).toBeVisible()
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy text' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('my words'))
    expect(
      await screen.findByRole('button', { name: 'Copied' })
    ).toBeInTheDocument()
  })
})
