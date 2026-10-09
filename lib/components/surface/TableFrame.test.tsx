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
  it('renders a named table with its head and rows', () => {
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
    expect(screen.getByRole('table', { name: 'Gear' })).toBeInTheDocument()
    expect(
      screen.getByRole('columnheader', { name: 'Name' })
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Road bike' })).toBeInTheDocument()
  })
})
