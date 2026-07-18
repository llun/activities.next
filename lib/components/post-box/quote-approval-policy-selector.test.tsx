/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { QuoteApprovalPolicySelector } from './quote-approval-policy-selector'

describe('QuoteApprovalPolicySelector', () => {
  it('shows the current policy label on the trigger', () => {
    render(<QuoteApprovalPolicySelector value="followers" onChange={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /followers can quote/i })
    ).toBeInTheDocument()
  })

  it('invokes onChange with the picked policy', async () => {
    const onChange = vi.fn()
    render(<QuoteApprovalPolicySelector value="public" onChange={onChange} />)

    // Radix dropdowns open from the keyboard in jsdom (matching the pattern
    // used by the post-menu / section-nav dropdown tests).
    fireEvent.keyDown(
      screen.getByRole('button', { name: /anyone can quote/i }),
      { key: 'ArrowDown' }
    )
    const option = await screen.findByRole('menuitemradio', {
      name: /no one can quote/i
    })
    fireEvent.click(option)

    expect(onChange).toHaveBeenCalledWith('nobody')
  })
})
