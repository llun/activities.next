/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { Status, StatusType } from '@/lib/types/domain/status'

import { ReadOnlyStats } from './read-only-stats'

const baseNote = {
  type: StatusType.enum.Note,
  totalShares: 4,
  totalLikes: 12
} as unknown as Status

describe('ReadOnlyStats', () => {
  it('renders boost and like totals', () => {
    render(<ReadOnlyStats status={baseNote} />)

    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('reads totals from the original status of a boost', () => {
    const announce = {
      type: StatusType.enum.Announce,
      originalStatus: {
        type: StatusType.enum.Note,
        totalShares: 7,
        totalLikes: 3
      }
    } as unknown as Status

    render(<ReadOnlyStats status={announce} />)

    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
