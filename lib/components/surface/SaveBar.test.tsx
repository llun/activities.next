/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { SaveBar, SavedIndicator } from './SaveBar'

const renderBar = (props: Partial<Parameters<typeof SaveBar>[0]> = {}) => {
  const onSave = vi.fn()
  render(
    <SaveBar
      dirty={false}
      saving={false}
      saved={false}
      onSave={onSave}
      {...props}
    />
  )
  return { onSave }
}

describe('SaveBar', () => {
  it('has a disabled Save button while the form is clean', () => {
    renderBar()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('says Unsaved changes and enables Save when dirty', () => {
    const { onSave } = renderBar({ dirty: true })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('shows Saved after a save, and Unsaved wins over it once edited again', () => {
    const { rerender } = render(
      <SaveBar dirty={false} saving={false} saved onSave={vi.fn()} />
    )
    expect(screen.getByText('Saved')).toBeInTheDocument()

    rerender(<SaveBar dirty saving={false} saved onSave={vi.fn()} />)
    expect(screen.queryByText('Saved')).toBeNull()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('keeps the label Save and disables the button while saving', () => {
    renderBar({ dirty: true, saving: true })
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button.querySelector('svg.animate-spin')).not.toBeNull()
  })

  it('announces an error as an alert in the alert colour instead of the status', () => {
    renderBar({ dirty: true, error: 'Could not save' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.getByRole('alert')).toHaveClass('text-destructive-text')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })
})

describe('SavedIndicator', () => {
  it('keeps its polite live region in the page and shows the tick when saved', () => {
    const { rerender } = render(<SavedIndicator saved={false} />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()

    rerender(<SavedIndicator saved />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('status')).toBe(region)
  })
})
