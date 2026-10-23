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
  it('shows the error as an alert, or without the role when errorLive is off', () => {
    const { rerender } = render(
      <SaveBar
        dirty
        saving={false}
        saved={false}
        error="Nope"
        onSave={vi.fn()}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Nope')
    rerender(
      <SaveBar
        dirty
        saving={false}
        saved={false}
        error="Nope"
        errorLive={false}
        onSave={vi.fn()}
      />
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Nope')).toBeVisible()
  })

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
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull()
  })

  it('announces an error as an alert instead of the status', () => {
    renderBar({ dirty: true, error: 'Could not save' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })
})

describe('SaveBar with a disabledReason', () => {
  it('keeps Save off but still says there are unsaved changes, and why', () => {
    renderBar({ dirty: true, disabledReason: 'Add a keyword to save' })

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
    expect(screen.getByText(/Add a keyword to save/)).toBeInTheDocument()
    expect(screen.queryByText('No unsaved changes')).toBeNull()
  })
})

describe('SaveBar with a dirtyLabel', () => {
  it('words the status for the page while the form has changes', () => {
    renderBar({ dirty: true, dirtyLabel: 'You have unsaved changes' })

    expect(screen.getByRole('status')).toHaveTextContent(
      'You have unsaved changes'
    )
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('does not use it once the form is clean', () => {
    renderBar({ dirty: false, dirtyLabel: 'You have unsaved changes' })

    expect(screen.getByText('No unsaved changes')).toBeVisible()
  })
})

describe('SaveBar with an actionLabel and an idleNote', () => {
  it('labels the edit button and shows the note while clean', () => {
    const { onSave } = renderBar({
      actionLabel: 'Save terms and privacy',
      idleNote: 'Changes apply to every domain.'
    })

    expect(screen.getByText('Changes apply to every domain.')).toBeVisible()
    expect(screen.queryByText('No unsaved changes')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    const button = screen.getByRole('button', {
      name: 'Save terms and privacy'
    })
    expect(button).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps a fragment note in one element of the status paragraph', () => {
    renderBar({
      actionLabel: 'Save',
      idleNote: (
        <>
          Changes apply to <span className="wrap-anywhere">run.example</span>{' '}
          only.
        </>
      )
    })

    const status = screen.getByRole('status')
    expect(status.children).toHaveLength(1)
    expect(status).toHaveTextContent('Changes apply to run.example only.')
    expect(status.children[0].textContent).toBe(
      'Changes apply to run.example only.'
    )
  })

  it('lets Unsaved changes, Saved and an error replace the note', () => {
    const props = { actionLabel: 'Save terms', idleNote: 'Applies to all.' }
    const { rerender } = render(
      <SaveBar {...props} dirty saving={false} saved={false} onSave={vi.fn()} />
    )
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.queryByText('Applies to all.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save terms' })).toBeEnabled()

    rerender(<SaveBar {...props} saved onSave={vi.fn()} />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByText('Applies to all.')).toBeNull()

    rerender(<SaveBar {...props} error="Nope" onSave={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Nope')
    expect(screen.queryByText('Applies to all.')).toBeNull()
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

  it('sets secondary actions beside Save, Save last', () => {
    const { onSave } = renderBar({
      dirty: true,
      actions: <a href="/back">Cancel</a>
    })

    const buttons = screen
      .getAllByRole('link')
      .concat(screen.getAllByRole('button'))
    expect(buttons.map((el) => el.textContent)).toEqual(['Cancel', 'Save'])
    expect(
      screen.getByRole('link', { name: 'Cancel' }).nextElementSibling
    ).toBe(screen.getByRole('button', { name: 'Save' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledTimes(1)
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

  it('drops the live region but still shows the tick with announce off', () => {
    const { rerender } = render(
      <SavedIndicator saved={false} announce={false} />
    )
    expect(screen.queryByRole('status')).toBeNull()

    rerender(<SavedIndicator saved announce={false} />)
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('status')).toBeNull()
    expect(document.querySelector('[aria-live]')).toBeNull()
  })
})

describe('SaveBar create variant', () => {
  it('shows the disabled reason as status text when there is no error', () => {
    render(
      <SaveBar
        variant="create"
        actionLabel="Add"
        disabledReason="Add a title"
      />
    )
    expect(screen.getByRole('status')).toHaveTextContent('Add a title')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('shows no status text and the form’s own action label, enabled', () => {
    render(<SaveBar variant="create" submit actionLabel="Save block" />)
    expect(screen.queryByText('No unsaved changes')).toBeNull()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save block' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save block' })).toHaveAttribute(
      'type',
      'submit'
    )
  })

  it('disables the button while saving or when told to', () => {
    const { rerender } = render(
      <SaveBar variant="create" actionLabel="Publish" saving />
    )
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
    rerender(<SaveBar variant="create" actionLabel="Publish" disabled />)
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('still shows an error', () => {
    render(<SaveBar variant="create" actionLabel="Publish" error="Nope" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Nope')
  })
})
