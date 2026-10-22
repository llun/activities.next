/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  OfflineSubmitButtons,
  OfflineSubmitCaption
} from './OfflineSubmitButtons'

const REASON = "Videos stay as drafts. Post this when you're back online."

describe('OfflineSubmitButtons', () => {
  it('offers Save draft and Send when online, each calling its own handler', () => {
    const onSaveDraft = vi.fn()
    const onQueue = vi.fn()
    render(
      <OfflineSubmitButtons
        disabled={false}
        onSaveDraft={onSaveDraft}
        onQueue={onQueue}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(onSaveDraft).toHaveBeenCalledTimes(1)
    expect(onQueue).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Send when online' }))
    expect(onQueue).toHaveBeenCalledTimes(1)
  })

  it('disables both buttons while there is nothing to hand over', () => {
    render(
      <OfflineSubmitButtons disabled onSaveDraft={vi.fn()} onQueue={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Send when online' })
    ).toBeDisabled()
  })

  it('keeps the queue button focusable and described by its reason, and never queues', () => {
    const onSaveDraft = vi.fn()
    const onQueue = vi.fn()
    render(
      <>
        <OfflineSubmitButtons
          disabled={false}
          queueDisabledReason={REASON}
          reasonId="reason"
          onSaveDraft={onSaveDraft}
          onQueue={onQueue}
        />
        <OfflineSubmitCaption
          state="offline"
          hasPoll={false}
          queueDisabledReason={REASON}
          reasonId="reason"
        />
      </>
    )
    const queue = screen.getByRole('button', { name: 'Send when online' })

    expect(queue).toHaveAttribute('aria-disabled', 'true')
    expect(queue).not.toBeDisabled()
    expect(queue).toHaveAccessibleDescription(REASON)
    queue.focus()
    expect(queue).toHaveFocus()
    fireEvent.click(queue)
    expect(onQueue).not.toHaveBeenCalled()
    // Save draft is unaffected.
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(onSaveDraft).toHaveBeenCalledTimes(1)
  })

  it('has no aria-disabled when the queue is available', () => {
    render(
      <OfflineSubmitButtons
        disabled={false}
        onSaveDraft={vi.fn()}
        onQueue={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Send when online' })
    ).not.toHaveAttribute('aria-disabled')
  })
})

describe('OfflineSubmitCaption', () => {
  it('says the app is offline and that queued posts go out while it is open', () => {
    render(<OfflineSubmitCaption state="offline" hasPoll={false} />)

    expect(
      screen.getByText(
        "You're offline. Posts you choose to send will go out when you're back online, while this app is open."
      )
    ).toBeInTheDocument()
  })

  it('says the server cannot be reached when the state is unreachable', () => {
    render(<OfflineSubmitCaption state="unreachable" hasPoll={false} />)

    expect(
      screen.getByText(
        "Can't reach the server. Posts you choose to send will go out when you're back online, while this app is open."
      )
    ).toBeInTheDocument()
  })

  it("adds the poll's duration line only with a poll", () => {
    const { rerender } = render(
      <OfflineSubmitCaption state="offline" hasPoll={false} />
    )
    expect(screen.queryByText(/The poll's duration/)).toBeNull()

    rerender(<OfflineSubmitCaption state="offline" hasPoll />)
    expect(
      screen.getByText(/The poll's duration starts when it's sent\./)
    ).toBeInTheDocument()
  })

  it('shows the reason the queue is unavailable', () => {
    render(
      <OfflineSubmitCaption
        state="offline"
        hasPoll={false}
        queueDisabledReason={REASON}
        reasonId="reason"
      />
    )

    expect(screen.getByText(REASON)).toHaveAttribute('id', 'reason')
  })
})
