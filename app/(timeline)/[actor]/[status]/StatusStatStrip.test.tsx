/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { StatusStatStrip } from './StatusStatStrip'

describe('StatusStatStrip', () => {
  it('renders the boost, like, and reply counts with their labels', () => {
    render(<StatusStatStrip boosts={14} likes={96} replies={3} />)

    for (const [count, label] of [
      ['14', 'Boosts'],
      ['96', 'Likes'],
      ['3', 'Replies']
    ]) {
      const value = screen.getByText(count)
      expect(value).toBeInTheDocument()
      expect(value.parentElement).toHaveTextContent(`${count}${label}`)
    }
  })

  it('renders zero counts rather than hiding them', () => {
    render(<StatusStatStrip boosts={0} likes={0} replies={0} />)

    expect(screen.getAllByText('0')).toHaveLength(3)
    expect(screen.getByText('Replies')).toBeInTheDocument()
  })
})
