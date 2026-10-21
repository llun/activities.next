/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import { PROFILE_FIELD_ERROR, ProfileFieldsField } from './ProfileFieldsField'
import { PROFILE_FIELDS_FIRST_CONTROL_ID } from './profileFieldsFieldIds'

const PROFILE_URL = 'https://llun.test/@anna'

type Saved = { name: string; value: string; verifiedAt?: number | null }

const renderField = (fields: Saved[] = [], describedBy?: string) =>
  render(
    <form>
      <ProfileFieldsField
        fields={fields}
        profileUrl={PROFILE_URL}
        describedBy={describedBy}
      />
    </form>
  )

// What the form would submit, in DOM order.
const submitted = (container: HTMLElement) => {
  const form = container.querySelector('form') as HTMLFormElement
  return [...new FormData(form).entries()].map(
    ([key, value]) => [key, String(value)] as const
  )
}

const chip = (name: string) => screen.getByRole('button', { name })

describe('ProfileFieldsField', () => {
  it('names the group from the row label', () => {
    render(
      <form>
        <span id="fields-label">Profile fields</span>
        <ProfileFieldsField
          fields={[]}
          profileUrl={PROFILE_URL}
          labelledBy="fields-label"
        />
      </form>
    )

    expect(
      screen.getByRole('group', { name: 'Profile fields' })
    ).toBeInTheDocument()
  })

  it('renders only the saved fields as rows', () => {
    renderField([{ name: 'Blog', value: 'https://blog.example' }])

    expect(screen.getByLabelText('Field 1 label')).toHaveValue('Blog')
    expect(screen.getByLabelText('Field 1 content')).toHaveValue(
      'https://blog.example'
    )
    expect(screen.queryByLabelText('Field 2 label')).not.toBeInTheDocument()
    expect(screen.getByText('Add a field · 3 left')).toBeInTheDocument()
  })

  it('skips empty saved rows', () => {
    renderField([
      { name: '', value: '' },
      { name: 'Blog', value: 'x' }
    ])

    expect(screen.getByLabelText('Field 1 label')).toHaveValue('Blog')
    expect(screen.queryByLabelText('Field 2 label')).not.toBeInTheDocument()
  })

  it('gives every control an accessible name', () => {
    renderField([
      { name: 'Location', value: 'Lisbon' },
      { name: '', value: 'x' }
    ])

    expect(screen.getByLabelText('Field 1 label')).toBeInTheDocument()
    expect(screen.getByLabelText('Field 1 content')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Move Location up' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move Location down' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Remove Location' })
    ).toBeInTheDocument()
    // An unlabelled row is named by its position.
    expect(
      screen.getByRole('button', { name: 'Move field 2 up' })
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Move field 2 down' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Remove field 2' })
    ).toBeInTheDocument()
  })

  it('points the row label at the first row, and at no chip without rows', () => {
    const { unmount } = renderField([{ name: 'Blog', value: 'x' }])
    expect(screen.getByLabelText('Field 1 label')).toHaveAttribute(
      'id',
      PROFILE_FIELDS_FIRST_CONTROL_ID
    )
    unmount()

    // A label for a chip would press it on click and add a field.
    renderField()
    expect(
      document.getElementById(PROFILE_FIELDS_FIRST_CONTROL_ID)
    ).not.toBeInTheDocument()
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

  describe('suggestion chips', () => {
    it('offers every chip, none of them type=submit', () => {
      renderField()

      for (const name of [
        'Location',
        'Pronouns',
        'Website',
        'Email',
        'Strava',
        'Photos',
        'Custom field'
      ]) {
        expect(chip(name)).toHaveAttribute('type', 'button')
      }
      expect(screen.getByText('Add a field · 4 left')).toBeInTheDocument()
    })

    it('adds a row with the label filled in and focuses its content', () => {
      renderField()

      fireEvent.click(chip('Location'))

      expect(screen.getByLabelText('Field 1 label')).toHaveValue('Location')
      expect(screen.getByLabelText('Field 1 content')).toHaveValue('')
      expect(screen.getByLabelText('Field 1 content')).toHaveFocus()
      expect(screen.getByText('Add a field · 3 left')).toBeInTheDocument()
    })

    it('adds an empty row for a custom field and focuses its label', () => {
      renderField()

      fireEvent.click(chip('Custom field'))

      expect(screen.getByLabelText('Field 1 label')).toHaveValue('')
      expect(screen.getByLabelText('Field 1 label')).toHaveFocus()
    })

    it('allows the same chip twice and saves the label as typed', () => {
      const { container } = renderField()

      fireEvent.click(chip('Website'))
      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: 'https://a.example' }
      })
      fireEvent.click(chip('Website'))
      fireEvent.change(screen.getByLabelText('Field 2 content'), {
        target: { value: 'https://b.example' }
      })
      fireEvent.change(screen.getByLabelText('Field 2 label'), {
        target: { value: 'My shop' }
      })

      expect(screen.getByLabelText('Field 1 label')).toHaveValue('Website')
      expect(submitted(container).slice(0, 4)).toEqual([
        ['fields[0][name]', 'Website'],
        ['fields[0][value]', 'https://a.example'],
        ['fields[1][name]', 'My shop'],
        ['fields[1][value]', 'https://b.example']
      ])
    })

    it('hides the chips at four rows and brings them back after a removal', () => {
      renderField([
        { name: 'A', value: '1' },
        { name: 'B', value: '2' },
        { name: 'C', value: '3' }
      ])

      fireEvent.click(chip('Email'))
      expect(screen.queryByText(/Add a field/)).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Custom field' })
      ).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Remove Email' }))
      expect(screen.getByText('Add a field · 1 left')).toBeInTheDocument()
    })
  })

  describe('form edits', () => {
    it('tells the form about adding, moving and removing a row', () => {
      const onInput = vi.fn()
      const { container } = renderField([
        { name: 'A', value: '1' },
        { name: 'B', value: '2' }
      ])
      container.querySelector('form')?.addEventListener('input', onInput)

      fireEvent.click(chip('Website'))
      expect(onInput).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: 'Move B up' }))
      expect(onInput).toHaveBeenCalledTimes(2)
      fireEvent.click(screen.getByRole('button', { name: 'Remove A' }))
      expect(onInput).toHaveBeenCalledTimes(3)
    })
  })

  describe('submitted fields', () => {
    it('always submits four pairs, padding unused slots with empty values', () => {
      const { container } = renderField([{ name: 'Blog', value: 'x' }])

      expect(submitted(container)).toEqual([
        ['fields[0][name]', 'Blog'],
        ['fields[0][value]', 'x'],
        ['fields[1][name]', ''],
        ['fields[1][value]', ''],
        ['fields[2][name]', ''],
        ['fields[2][value]', ''],
        ['fields[3][name]', ''],
        ['fields[3][value]', '']
      ])
    })

    it('still submits four empty pairs once every field is removed', () => {
      const { container } = renderField([
        { name: 'A', value: '1' },
        { name: 'B', value: '2' }
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Remove A' }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove B' }))

      const entries = submitted(container)
      expect(entries).toHaveLength(8)
      expect(entries.every(([, value]) => value === '')).toBe(true)
      expect(entries.map(([key]) => key)).toEqual(
        [0, 1, 2, 3].flatMap((i) => [
          `fields[${i}][name]`,
          `fields[${i}][value]`
        ])
      )
    })

    it('reorders the submitted names with Move up and Move down', () => {
      const { container } = renderField([
        { name: 'A', value: '1' },
        { name: 'B', value: '2' },
        { name: 'C', value: '3' }
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Move C up' }))
      expect(submitted(container).slice(0, 6)).toEqual([
        ['fields[0][name]', 'A'],
        ['fields[0][value]', '1'],
        ['fields[1][name]', 'C'],
        ['fields[1][value]', '3'],
        ['fields[2][name]', 'B'],
        ['fields[2][value]', '2']
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Move A down' }))
      expect(
        submitted(container)
          .filter(([key]) => key.endsWith('[name]'))
          .map(([, value]) => value)
      ).toEqual(['C', 'A', 'B', ''])
    })

    it('disables Move up on the first row and Move down on the last', () => {
      renderField([
        { name: 'A', value: '1' },
        { name: 'B', value: '2' }
      ])

      expect(screen.getByRole('button', { name: 'Move A up' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Move A down' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Move B up' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'Move B down' })).toBeDisabled()
    })
  })

  describe('focus', () => {
    const three = [
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
      { name: 'C', value: '3' }
    ]

    it('moves to the next row label after a removal', () => {
      renderField(three)

      fireEvent.click(screen.getByRole('button', { name: 'Remove A' }))

      expect(screen.getByLabelText('Field 1 label')).toHaveValue('B')
      expect(screen.getByLabelText('Field 1 label')).toHaveFocus()
    })

    it('moves to the previous row label after removing the last row', () => {
      renderField(three)

      fireEvent.click(screen.getByRole('button', { name: 'Remove C' }))

      expect(screen.getByLabelText('Field 2 label')).toHaveValue('B')
      expect(screen.getByLabelText('Field 2 label')).toHaveFocus()
    })

    it('moves to the first chip after removing the only row', () => {
      renderField([{ name: 'A', value: '1' }])

      fireEvent.click(screen.getByRole('button', { name: 'Remove A' }))

      expect(chip('Location')).toHaveFocus()
    })

    it('keeps focus on the same button of the moved row', () => {
      renderField(three)

      fireEvent.click(screen.getByRole('button', { name: 'Move B down' }))
      expect(screen.getByRole('button', { name: 'Move B up' })).toBeEnabled()
      // B is last now, so its Move down is disabled and the focus goes to Up.
      expect(screen.getByRole('button', { name: 'Move B up' })).toHaveFocus()

      // C moves to the top, so its Move up is disabled and Down is focused.
      fireEvent.click(screen.getByRole('button', { name: 'Move C up' }))
      expect(screen.getByRole('button', { name: 'Move C down' })).toHaveFocus()
    })

    it('keeps Move up focused while the row is not yet at the top', () => {
      renderField(three)

      fireEvent.click(screen.getByRole('button', { name: 'Move C up' }))
      expect(screen.getByRole('button', { name: 'Move C up' })).toHaveFocus()

      // C is first now: Up is disabled, so Down gets the focus.
      fireEvent.click(screen.getByRole('button', { name: 'Move C up' }))
      expect(screen.getByRole('button', { name: 'Move C down' })).toHaveFocus()
    })
  })

  describe('validation', () => {
    it('shows no error for a complete or empty row', () => {
      renderField([{ name: 'Blog', value: 'x' }])
      expect(screen.queryByText(PROFILE_FIELD_ERROR)).not.toBeInTheDocument()
    })

    it('says why a half-filled row is wrong once the person leaves it', () => {
      renderField([{ name: 'Blog', value: 'x' }])
      const label = screen.getByLabelText('Field 1 label')
      const content = screen.getByLabelText('Field 1 content')

      fireEvent.change(content, { target: { value: '' } })
      expect(screen.queryByText(PROFILE_FIELD_ERROR)).not.toBeInTheDocument()

      // Moving on to the same row's content is not leaving the row.
      fireEvent.blur(label, { relatedTarget: content })
      expect(screen.queryByText(PROFILE_FIELD_ERROR)).not.toBeInTheDocument()

      fireEvent.blur(content, { relatedTarget: document.body })
      expect(screen.getByText(PROFILE_FIELD_ERROR)).toBeInTheDocument()
      expect(content).toHaveAttribute('aria-invalid', 'true')
    })

    it('blocks the native submit for a half-filled row and clears once it is complete', () => {
      const { container } = renderField()
      const form = container.querySelector('form') as HTMLFormElement

      fireEvent.click(chip('Website'))
      fireEvent.change(screen.getByLabelText('Field 1 label'), {
        target: { value: 'Site' }
      })
      // A chip row starts with its content empty.
      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: '' }
      })
      let valid = true
      act(() => {
        valid = form.checkValidity()
      })
      expect(valid).toBe(false)
      expect(screen.getByText(PROFILE_FIELD_ERROR)).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: 'https://x.example' }
      })
      expect(form.checkValidity()).toBe(true)
      expect(screen.queryByText(PROFILE_FIELD_ERROR)).not.toBeInTheDocument()
    })

    it('treats a row emptied by hand as removable, not invalid', () => {
      const { container } = renderField([{ name: 'Blog', value: 'x' }])

      fireEvent.change(screen.getByLabelText('Field 1 label'), {
        target: { value: '' }
      })
      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: '' }
      })

      expect(
        (container.querySelector('form') as HTMLFormElement).checkValidity()
      ).toBe(true)
    })

    it('flags a half-filled saved row on mount and blocks the submit', () => {
      const { container } = renderField([{ name: 'Pronouns', value: '' }])

      expect(screen.getByRole('alert')).toHaveTextContent(PROFILE_FIELD_ERROR)
      expect(
        (container.querySelector('form') as HTMLFormElement).checkValidity()
      ).toBe(false)
    })

    it('keeps a row error with its row after a move', () => {
      renderField([
        { name: 'Pronouns', value: '' },
        { name: 'Blog', value: 'x' }
      ])

      fireEvent.click(
        screen.getByRole('button', { name: 'Move Pronouns down' })
      )

      expect(screen.getByLabelText('Field 2 label')).toHaveValue('Pronouns')
      expect(screen.getByLabelText('Field 2 content')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
      expect(screen.getByLabelText('Field 1 content')).not.toHaveAttribute(
        'aria-invalid'
      )
    })

    it('points every input at the row hint, and at the error when there is one', () => {
      renderField(
        [
          { name: 'Pronouns', value: '' },
          { name: 'Blog', value: 'x' }
        ],
        'hint-id'
      )

      expect(screen.getByLabelText('Field 2 label')).toHaveAttribute(
        'aria-describedby',
        'hint-id'
      )
      expect(screen.getByLabelText('Field 1 content')).toHaveAttribute(
        'aria-describedby',
        'hint-id profileField0Error'
      )
    })
  })

  describe('icon', () => {
    const iconOf = (row: number) =>
      screen
        .getByLabelText(`Field ${row} label`)
        .closest('div')
        ?.querySelector('[data-slot="profile-field-icon"]')

    it('is decorative', () => {
      renderField([{ name: 'Blog', value: 'x' }])
      expect(iconOf(1)).toHaveAttribute('aria-hidden', 'true')
    })

    it('follows the label and content as they are typed', () => {
      renderField([{ name: 'Notes', value: 'hello' }])
      expect(iconOf(1)).toHaveAttribute('data-icon', 'text')

      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: 'https://example.com' }
      })
      expect(iconOf(1)).toHaveAttribute('data-icon', 'link')

      fireEvent.change(screen.getByLabelText('Field 1 label'), {
        target: { value: 'Location' }
      })
      expect(iconOf(1)).toHaveAttribute('data-icon', 'location')
    })

    it('names a pin for Location, a globe for a link and a tag for text', () => {
      renderField([
        { name: 'Location', value: 'Lisbon' },
        { name: 'Site', value: 'https://example.com' },
        { name: 'Pronouns', value: 'she/her' }
      ])

      expect(iconOf(1)).toHaveAttribute('data-icon', 'location')
      expect(iconOf(2)).toHaveAttribute('data-icon', 'link')
      expect(iconOf(3)).toHaveAttribute('data-icon', 'text')
    })
  })

  describe('verification status', () => {
    const BLOG = { name: 'Blog', value: 'https://blog.example' }

    it('shows Verified with a check for a saved URL that was checked', () => {
      renderField([{ ...BLOG, verifiedAt: 1700000000000 }])

      const status = screen.getByText('Verified', {
        selector: '[data-slot="profile-link-status"]'
      })
      expect(status.querySelector('svg')).toBeInTheDocument()
      expect(status).toHaveClass('text-success-text')
      expect(screen.queryByText('Not verified')).not.toBeInTheDocument()
    })

    it('shows muted Not verified for a saved URL that was not checked', () => {
      renderField([BLOG])

      const status = screen.getByText('Not verified')
      expect(status).toHaveClass('text-muted-foreground')
      expect(status.querySelector('svg')).not.toBeInTheDocument()
    })

    it('shows no status for an http link, plain text or a half-filled row', () => {
      renderField([
        { name: 'Old', value: 'http://old.example', verifiedAt: 1 },
        { name: 'Pronouns', value: 'they/them', verifiedAt: 1700000000000 },
        { name: 'Half', value: '' }
      ])

      expect(
        document.querySelector('[data-slot="profile-link-status"]')
      ).not.toBeInTheDocument()
    })

    it('adds the status to the content input description only', () => {
      renderField([{ ...BLOG, verifiedAt: 1700000000000 }], 'row-hint')

      const status = document.querySelector(
        '[data-slot="profile-link-status"]'
      ) as HTMLElement
      expect(screen.getByLabelText('Field 1 content')).toHaveAttribute(
        'aria-describedby',
        `row-hint ${status.id}`
      )
      expect(screen.getByLabelText('Field 1 label')).toHaveAttribute(
        'aria-describedby',
        'row-hint'
      )
    })

    it('hides the status once the content is edited, since it describes the saved value', () => {
      renderField([{ ...BLOG, verifiedAt: 1700000000000 }])

      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: 'https://other.example' }
      })

      expect(
        document.querySelector('[data-slot="profile-link-status"]')
      ).not.toBeInTheDocument()
    })

    it('never shows an unsaved link as verified', () => {
      renderField()

      fireEvent.click(chip('Website'))
      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: 'https://new.example' }
      })

      expect(
        document.querySelector('[data-slot="profile-link-status"]')
      ).not.toBeInTheDocument()
    })

    it('follows the saved value when rows move, not the position', () => {
      renderField([
        { name: 'Location', value: 'Lisbon' },
        { ...BLOG, verifiedAt: 1700000000000 }
      ])

      fireEvent.click(screen.getByRole('button', { name: 'Move Blog up' }))

      expect(screen.getByLabelText('Field 1 content')).toHaveValue(
        'https://blog.example'
      )
      const statuses = document.querySelectorAll(
        '[data-slot="profile-link-status"]'
      )
      expect(statuses).toHaveLength(1)
      expect(statuses[0]).toHaveTextContent('Verified')
      expect(statuses[0].closest('div')).toContainElement(
        screen.getByLabelText('Field 1 content')
      )
    })

    it('keeps the status when a row is relabelled', () => {
      renderField([{ ...BLOG, verifiedAt: 1700000000000 }])

      fireEvent.change(screen.getByLabelText('Field 1 label'), {
        target: { value: 'My blog' }
      })

      expect(
        document.querySelector('[data-slot="profile-link-status"]')
      ).toHaveTextContent('Verified')
    })
  })

  describe('preview', () => {
    const preview = () =>
      document.querySelector(
        '[data-slot="profile-fields-preview"]'
      ) as HTMLElement

    it('says there is nothing to show without a filled row', () => {
      renderField()

      expect(within(preview()).getByText('On your profile')).toBeInTheDocument()
      expect(
        within(preview()).getByText('Nothing to show yet.')
      ).toBeInTheDocument()
    })

    it('does not show a half-filled row', () => {
      renderField([{ name: 'Pronouns', value: '' }])

      expect(
        within(preview()).getByText('Nothing to show yet.')
      ).toBeInTheDocument()
    })

    it('renders the current rows like the profile does, live', () => {
      renderField([
        { name: 'Location', value: 'Lisbon' },
        { name: 'Site', value: 'https://example.com' }
      ])

      expect(within(preview()).getByText('Lisbon')).toBeInTheDocument()
      expect(
        within(preview()).getByRole('link', { name: /example\.com/ })
      ).toHaveAttribute('href', 'https://example.com')
      expect(
        within(preview()).queryByText('Nothing to show yet.')
      ).not.toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: 'Porto' }
      })
      expect(within(preview()).getByText('Porto')).toBeInTheDocument()
      expect(within(preview()).queryByText('Lisbon')).not.toBeInTheDocument()
    })

    it('marks only a saved verified value as verified', () => {
      renderField([
        {
          name: 'Blog',
          value: 'https://blog.example',
          verifiedAt: 1700000000000
        },
        { name: 'Shop', value: 'https://shop.example' }
      ])

      expect(
        within(preview()).getAllByRole('img', { name: 'Verified' })
      ).toHaveLength(1)

      fireEvent.change(screen.getByLabelText('Field 1 content'), {
        target: { value: 'https://other.example' }
      })
      expect(
        within(preview()).queryByRole('img', { name: 'Verified' })
      ).not.toBeInTheDocument()
    })
  })
})
