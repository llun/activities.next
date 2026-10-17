/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { PROFILE_LINK_ERROR, ProfileLinksField } from './ProfileLinksField'

const PROFILE_URL = 'https://llun.test/@anna'

const renderField = (
  fields: { name: string; value: string }[] = [],
  describedBy?: string
) =>
  render(
    <form>
      <ProfileLinksField
        fields={fields}
        profileUrl={PROFILE_URL}
        describedBy={describedBy}
      />
    </form>
  )

describe('ProfileLinksField', () => {
  it('names the group from the row label', () => {
    render(
      <form>
        <span id="links-label">Profile links</span>
        <ProfileLinksField
          fields={[]}
          profileUrl={PROFILE_URL}
          labelledBy="links-label"
        />
      </form>
    )

    expect(
      screen.getByRole('group', { name: 'Profile links' })
    ).toBeInTheDocument()
  })

  it('renders four label and content pairs with their form names', () => {
    renderField()

    for (const index of [0, 1, 2, 3]) {
      expect(screen.getByLabelText(`Link ${index + 1} label`)).toHaveAttribute(
        'name',
        `fields[${index}][name]`
      )
      expect(
        screen.getByLabelText(`Link ${index + 1} content`)
      ).toHaveAttribute('name', `fields[${index}][value]`)
    }
    expect(screen.getAllByPlaceholderText('Label')).toHaveLength(4)
    expect(screen.getAllByPlaceholderText('https://… or text')).toHaveLength(4)
  })

  it('fills the rows from the saved fields', () => {
    renderField([{ name: 'Blog', value: 'https://blog.example' }])

    expect(screen.getByLabelText('Link 1 label')).toHaveValue('Blog')
    expect(screen.getByLabelText('Link 1 content')).toHaveValue(
      'https://blog.example'
    )
    expect(screen.getByLabelText('Link 2 label')).toHaveValue('')
  })

  it('shows the rel me snippet with the profile URL', () => {
    renderField()

    expect(
      screen.getByText(/add a link back to your profile with/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(`<a rel="me" href="${PROFILE_URL}">Activities.next</a>`)
        .tagName
    ).toBe('CODE')
  })

  it('shows no error for a complete or empty row', () => {
    renderField([{ name: 'Blog', value: 'x' }])
    expect(screen.queryByText(PROFILE_LINK_ERROR)).not.toBeInTheDocument()
  })

  it('says why a half-filled row is wrong once the person leaves it', () => {
    renderField()
    const label = screen.getByLabelText('Link 1 label')
    const content = screen.getByLabelText('Link 1 content')

    fireEvent.change(label, { target: { value: 'Blog' } })
    expect(screen.queryByText(PROFILE_LINK_ERROR)).not.toBeInTheDocument()

    // Moving on to the same row's content is not leaving the row.
    fireEvent.blur(label, { relatedTarget: content })
    expect(screen.queryByText(PROFILE_LINK_ERROR)).not.toBeInTheDocument()

    fireEvent.blur(content, { relatedTarget: document.body })
    expect(screen.getByText(PROFILE_LINK_ERROR)).toBeInTheDocument()
    expect(content).toHaveAttribute('aria-invalid', 'true')
  })

  it('blocks the native submit for a half-filled row and clears once it is complete', () => {
    const { container } = renderField()
    const form = container.querySelector('form') as HTMLFormElement
    const content = screen.getByLabelText('Link 2 content')

    fireEvent.change(content, { target: { value: 'https://x.example' } })
    // The browser fires `invalid` at the blocked input when Save is pressed.
    let valid = true
    act(() => {
      valid = form.checkValidity()
    })
    expect(valid).toBe(false)
    expect(screen.getByText(PROFILE_LINK_ERROR)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Link 2 label'), {
      target: { value: 'Site' }
    })
    expect(form.checkValidity()).toBe(true)
    expect(screen.queryByText(PROFILE_LINK_ERROR)).not.toBeInTheDocument()
  })

  it('treats a row emptied by hand as removed, not invalid', () => {
    const { container } = renderField([{ name: 'Blog', value: 'x' }])

    fireEvent.change(screen.getByLabelText('Link 1 label'), {
      target: { value: '' }
    })
    fireEvent.change(screen.getByLabelText('Link 1 content'), {
      target: { value: '' }
    })

    expect(
      (container.querySelector('form') as HTMLFormElement).checkValidity()
    ).toBe(true)
  })

  it('flags a half-filled saved row on mount and blocks the submit', () => {
    const { container } = renderField([{ name: 'Pronouns', value: '' }])

    expect(screen.getByRole('alert')).toHaveTextContent(PROFILE_LINK_ERROR)
    expect(
      (container.querySelector('form') as HTMLFormElement).checkValidity()
    ).toBe(false)
  })

  it('points every input at the row hint, and at the error when there is one', () => {
    renderField([{ name: 'Pronouns', value: '' }], 'hint-id')

    expect(screen.getByLabelText('Link 2 label')).toHaveAttribute(
      'aria-describedby',
      'hint-id'
    )
    expect(screen.getByLabelText('Link 1 content')).toHaveAttribute(
      'aria-describedby',
      'hint-id profileField0Error'
    )
  })
})
