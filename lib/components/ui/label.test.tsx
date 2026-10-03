/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Label } from './label'

describe('Label', () => {
  it('sets every label on a 14/20 line, as the design draws the form labels', () => {
    render(<Label htmlFor="name">Name</Label>)

    // 20 px high, so a field sits 28 px below its label's top. The old
    // `leading-none` (14 px) is gone from the shared label and no call site
    // needs to ask for the roomier line any more.
    const label = screen.getByText('Name')
    expect(label).toHaveClass('text-sm', 'leading-5', 'font-medium')
    expect(label).not.toHaveClass('leading-none')
  })

  it('keeps a call site free to set its own line height', () => {
    render(<Label className="leading-none">Tight</Label>)

    const label = screen.getByText('Tight')
    expect(label).toHaveClass('leading-none')
    expect(label).not.toHaveClass('leading-5')
  })
})
