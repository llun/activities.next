/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import {
  TABLE_CELL_CLASS,
  TABLE_HEAD_ROW_CLASS,
  TableFrame
} from './TableFrame'

describe('TableFrame', () => {
  it('puts the table in a frame that scrolls sideways', () => {
    render(
      <TableFrame aria-label="Gear" tableClassName="min-w-[560px]">
        <thead>
          <tr className={TABLE_HEAD_ROW_CLASS}>
            <th className={TABLE_CELL_CLASS}>Name</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={TABLE_CELL_CLASS}>Road bike</td>
          </tr>
        </tbody>
      </TableFrame>
    )
    const table = screen.getByRole('table', { name: 'Gear' })
    expect(table).toHaveClass('min-w-[560px]')
    expect(table.parentElement).toHaveClass('overflow-x-auto')
    expect(table.parentElement?.parentElement).toHaveClass(
      'rounded-lg',
      'border'
    )
  })

  it('draws the header band as the muted Fitness band', () => {
    expect(TABLE_HEAD_ROW_CLASS).toBe(
      'bg-muted/40 text-muted-foreground border-b text-left text-xs'
    )
    expect(TABLE_CELL_CLASS).toBe('px-3 py-2.5')
  })
})
