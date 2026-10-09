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
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
  })

  it('says Unsaved changes and enables Save when dirty', () => {
    const { onSave } = renderBar({ dirty: true })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('shows All changes saved after a save, and Unsaved wins over it once edited again', () => {
    const { rerender } = render(
      <SaveBar dirty={false} saving={false} saved onSave={vi.fn()} />
    )
    expect(screen.getByText('All changes saved')).toBeInTheDocument()

    rerender(<SaveBar dirty saving={false} saved onSave={vi.fn()} />)
    expect(screen.queryByText('All changes saved')).toBeNull()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('keeps the label Save and disables the button while saving', () => {
    renderBar({ dirty: true, saving: true })
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull()
  })

  it('announces an error as an alert instead of the status', () => {
    renderBar({ dirty: true, error: 'Could not save' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })
})

describe('SaveBar as a submit button', () => {
  it('submits the enclosing form instead of calling onSave', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    const onSave = vi.fn()
    render(
      <form onSubmit={onSubmit}>
        <SaveBar dirty saving={false} saved={false} submit onSave={onSave} />
      </form>
    )

    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'submit')
    fireEvent.click(button)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('stays a plain button without submit', () => {
    renderBar({ dirty: true })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute(
      'type',
      'button'
    )
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
