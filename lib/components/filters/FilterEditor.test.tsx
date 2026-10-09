/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { ClientFilter, FilterInput } from '@/lib/client'

import { FilterEditor, type FilterScope } from './FilterEditor'

const filterWithAction = (filterAction: string) =>
  ({
    id: `f-${filterAction}`,
    title: 'Spoilers',
    context: ['home'],
    filter_action: filterAction,
    expires_at: null,
    keywords: []
  }) as unknown as ClientFilter

describe('FilterEditor', () => {
  // The editor only offers warn/hide cards. A valid card action opens with its
  // own card selected; a filter saved with another action (e.g. `blur`, valid
  // via the API since Mastodon 4.4) opens as warn rather than leaving the
  // radiogroup with nothing checked.
  it.each([
    {
      description: 'keeps warn selected',
      filterAction: 'warn',
      checked: 'warn'
    },
    {
      description: 'keeps hide selected',
      filterAction: 'hide',
      checked: 'hide'
    },
    {
      description: 'falls back to warn for a non-card action (blur)',
      filterAction: 'blur',
      checked: 'warn'
    }
  ])('$description', ({ filterAction, checked }) => {
    render(
      <FilterEditor
        initial={filterWithAction(filterAction)}
        scope="account"
        currentTime={0}
        saving={false}
        error={null}
        onCancel={() => {}}
        onSave={() => {}}
      />
    )

    const warnRadio = screen.getByRole('radio', {
      name: /Hide with a warning/i
    })
    const hideRadio = screen.getByRole('radio', { name: /Hide completely/i })
    expect(warnRadio).toHaveAttribute(
      'aria-checked',
      checked === 'warn' ? 'true' : 'false'
    )
    expect(hideRadio).toHaveAttribute(
      'aria-checked',
      checked === 'hide' ? 'true' : 'false'
    )
  })

  describe('warn preview', () => {
    const renderEditor = (filterAction: string) =>
      render(
        <FilterEditor
          initial={filterWithAction(filterAction)}
          scope="account"
          currentTime={0}
          saving={false}
          error={null}
          onCancel={() => {}}
          onSave={() => {}}
        />
      )

    it('shows the bare "Filtered" bar for a warn filter, with no frame or caption', () => {
      renderEditor('warn')

      const bar = screen.getByText('Filtered: Spoilers').parentElement
      expect(bar).toHaveTextContent('Show anyway')
      // No PREVIEW caption around it.
      expect(screen.queryByText('Preview')).not.toBeInTheDocument()
    })

    it('shows no preview for a hide filter', () => {
      renderEditor('hide')

      expect(screen.queryByText('Show anyway')).not.toBeInTheDocument()
    })
  })

  describe('saving', () => {
    const renderNew = (
      props: Partial<Parameters<typeof FilterEditor>[0]> = {}
    ) => {
      const onSave = vi.fn()
      const onCancel = vi.fn()
      render(
        <FilterEditor
          initial={null}
          scope="account"
          currentTime={0}
          saving={false}
          error={null}
          onCancel={onCancel}
          onSave={onSave}
          {...props}
        />
      )
      return { onSave, onCancel }
    }

    it('keeps Save disabled until a keyword has text', () => {
      renderNew()

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

      fireEvent.change(screen.getByLabelText('Keyword or phrase 1'), {
        target: { value: 'spoiler' }
      })

      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
      expect(screen.queryByText(/Add a keyword to save/)).toBeNull()
    })

    it('says why Save is off while a typed title has no keyword yet', () => {
      renderNew()

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Spoilers' }
      })

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument()
      expect(screen.getByText(/Add a keyword to save/)).toBeInTheDocument()
      expect(screen.queryByText('No unsaved changes')).toBeNull()
    })

    it('does not call it clean when every keyword of a saved filter is cleared', () => {
      renderNew({
        initial: {
          ...filterWithAction('warn'),
          keywords: [{ id: 'k1', keyword: 'spoiler', whole_word: true }]
        } as unknown as ClientFilter
      })

      fireEvent.change(screen.getByLabelText('Keyword or phrase 1'), {
        target: { value: '' }
      })

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      expect(screen.getByText(/Add a keyword to save/)).toBeInTheDocument()
      expect(screen.queryByText('No unsaved changes')).toBeNull()
    })

    it('saves the new filter with the title and keyword', () => {
      const { onSave } = renderNew()

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Spoilers' }
      })
      fireEvent.change(screen.getByLabelText('Keyword or phrase 1'), {
        target: { value: ' spoiler ' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Spoilers',
          filterAction: 'warn',
          keywords: [{ keyword: 'spoiler', wholeWord: true }]
        })
      )
    })

    it('leaves an existing filter clean until something changes', () => {
      renderNew({
        initial: {
          ...filterWithAction('warn'),
          keywords: [{ id: 'k1', keyword: 'spoiler', whole_word: true }]
        } as unknown as ClientFilter
      })

      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

      fireEvent.click(screen.getByRole('radio', { name: /Hide completely/i }))

      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('shows the save error in the bar and goes back with Back', () => {
      const { onCancel } = renderNew({ error: 'Failed to create filter.' })

      expect(screen.getByRole('alert')).toHaveTextContent(
        'Failed to create filter.'
      )

      fireEvent.click(screen.getByRole('button', { name: 'Back' }))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('moves between the action options with the arrow keys', () => {
      renderNew()

      const warn = screen.getByRole('radio', { name: /Hide with a warning/i })
      fireEvent.keyDown(warn, { key: 'ArrowDown' })

      expect(
        screen.getByRole('radio', { name: /Hide completely/i })
      ).toHaveAttribute('aria-checked', 'true')
    })

    it('does not add a second h1 to the page', () => {
      renderNew()

      expect(
        screen.queryByRole('heading', { level: 1 })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('heading', { level: 2, name: 'Add filter' })
      ).toBeInTheDocument()
    })
  })
})

const existingFilter = (overrides: Partial<ClientFilter> = {}): ClientFilter =>
  ({
    id: 'f-1',
    title: 'Spoilers',
    context: ['home', 'public'],
    filter_action: 'hide',
    expires_at: null,
    keywords: [
      { id: 'k-1', keyword: 'finale', whole_word: true },
      { id: 'k-2', keyword: 'twist', whole_word: false }
    ],
    ...overrides
  }) as unknown as ClientFilter

describe('FilterEditor form behaviour', () => {
  const renderEditor = (
    props: {
      initial?: ClientFilter | null
      scope?: FilterScope
      saving?: boolean
      error?: string | null
      currentTime?: number
    } = {}
  ) => {
    const onSave = vi.fn<(input: FilterInput) => void>()
    const onCancel = vi.fn()
    render(
      <FilterEditor
        initial={props.initial ?? null}
        scope={props.scope ?? 'account'}
        currentTime={props.currentTime ?? 0}
        saving={props.saving ?? false}
        error={props.error ?? null}
        onCancel={onCancel}
        onSave={onSave}
      />
    )
    return { onSave, onCancel }
  }

  const keywordInput = (index: number) =>
    screen.getByRole('textbox', { name: `Keyword or phrase ${index}` })
  const saveButton = (name = 'Save') => screen.getByRole('button', { name })

  describe('creating a filter', () => {
    it('starts with the home context, warn action, no expiry and one blank whole-word keyword', () => {
      renderEditor()

      expect(
        screen.getByRole('heading', { level: 2, name: 'Add filter' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('checkbox', { name: /Home and lists/ })
      ).toBeChecked()
      expect(
        screen.getByRole('checkbox', { name: /Notifications/ })
      ).not.toBeChecked()
      expect(
        screen.getByRole('radio', { name: /Hide with a warning/ })
      ).toHaveAttribute('aria-checked', 'true')
      expect(screen.getByLabelText('Expire after')).toHaveValue('0')
      expect(keywordInput(1)).toHaveValue('')
      expect(screen.getByRole('switch')).toBeChecked()
    })

    it('blocks saving until a keyword has text', () => {
      renderEditor()
      expect(saveButton()).toBeDisabled()

      fireEvent.change(keywordInput(1), { target: { value: '   ' } })
      expect(saveButton()).toBeDisabled()

      fireEvent.change(keywordInput(1), { target: { value: 'spoiler' } })
      expect(saveButton()).toBeEnabled()
    })

    it('saves the defaults with an "Untitled filter" title when none is given', () => {
      const { onSave } = renderEditor()
      fireEvent.change(keywordInput(1), { target: { value: ' spoiler ' } })

      fireEvent.click(saveButton())

      expect(onSave).toHaveBeenCalledWith({
        title: 'Untitled filter',
        context: ['home'],
        filterAction: 'warn',
        expiresIn: null,
        keywords: [{ keyword: 'spoiler', wholeWord: true }]
      })
    })

    it('saves the edited title, contexts, action, expiry and keywords, dropping blank keyword rows', () => {
      const { onSave } = renderEditor()
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: '  Politics  ' }
      })
      fireEvent.click(screen.getByRole('checkbox', { name: /Notifications/ }))
      fireEvent.click(screen.getByRole('radio', { name: /Hide completely/ }))
      fireEvent.change(screen.getByLabelText('Expire after'), {
        target: { value: '3600' }
      })
      fireEvent.change(keywordInput(1), { target: { value: 'election' } })
      fireEvent.click(screen.getByRole('switch'))
      fireEvent.click(screen.getByRole('button', { name: /Add keyword/ }))
      fireEvent.click(screen.getByRole('button', { name: /Add keyword/ }))
      fireEvent.change(keywordInput(3), { target: { value: 'ballot box' } })

      fireEvent.click(saveButton())

      expect(onSave).toHaveBeenCalledWith({
        title: 'Politics',
        context: ['home', 'notifications'],
        filterAction: 'hide',
        expiresIn: 3600,
        keywords: [
          { keyword: 'election', wholeWord: false },
          { keyword: 'ballot box', wholeWord: true }
        ]
      })
    })

    it('falls back to the home context when every context is unchecked', () => {
      const { onSave } = renderEditor()
      fireEvent.change(keywordInput(1), { target: { value: 'spoiler' } })
      fireEvent.click(screen.getByRole('checkbox', { name: /Home and lists/ }))

      fireEvent.click(saveButton())

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ context: ['home'] })
      )
    })

    it('removes a freshly added keyword row without sending a delete for it', () => {
      const { onSave } = renderEditor()
      fireEvent.change(keywordInput(1), { target: { value: 'keep' } })
      fireEvent.click(screen.getByRole('button', { name: /Add keyword/ }))
      fireEvent.change(keywordInput(2), { target: { value: 'discard' } })

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove keyword discard' })
      )
      fireEvent.click(saveButton())

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          keywords: [{ keyword: 'keep', wholeWord: true }]
        })
      )
    })
  })

  describe('editing an existing filter', () => {
    it('prefills the form from the filter', () => {
      renderEditor({ initial: existingFilter() })

      expect(
        screen.getByRole('heading', { name: 'Edit “Spoilers”' })
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveValue('Spoilers')
      expect(
        screen.getByRole('checkbox', { name: /Home and lists/ })
      ).toBeChecked()
      expect(
        screen.getByRole('checkbox', { name: /Public timelines/ })
      ).toBeChecked()
      expect(
        screen.getByRole('checkbox', { name: /Notifications/ })
      ).not.toBeChecked()
      expect(keywordInput(1)).toHaveValue('finale')
      expect(keywordInput(2)).toHaveValue('twist')
      expect(
        screen.getByRole('switch', { name: 'Whole word for finale' })
      ).toBeChecked()
      expect(
        screen.getByRole('switch', { name: 'Whole word for twist' })
      ).not.toBeChecked()
    })

    it('sends unchanged keywords with their ids so they are kept, not recreated', () => {
      const { onSave } = renderEditor({ initial: existingFilter() })

      // Save stays disabled until something changes; rename to make it dirty.
      expect(saveButton()).toBeDisabled()
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Renamed' }
      })
      fireEvent.click(saveButton())

      expect(onSave).toHaveBeenCalledWith({
        title: 'Renamed',
        context: ['home', 'public'],
        filterAction: 'hide',
        expiresIn: null,
        keywords: [
          { id: 'k-1', keyword: 'finale', wholeWord: true },
          { id: 'k-2', keyword: 'twist', wholeWord: false }
        ]
      })
    })

    it('marks a removed existing keyword with _destroy and keeps the others', () => {
      const { onSave } = renderEditor({ initial: existingFilter() })

      fireEvent.click(
        screen.getByRole('button', { name: 'Remove keyword finale' })
      )
      fireEvent.click(saveButton())

      const { keywords } = onSave.mock.calls[0][0]
      expect(keywords).toEqual([
        { id: 'k-2', keyword: 'twist', wholeWord: false },
        { id: 'k-1', keyword: '', wholeWord: false, _destroy: true }
      ])
    })

    it('treats clearing the text of an existing keyword as deleting it', () => {
      const { onSave } = renderEditor({ initial: existingFilter() })

      fireEvent.change(keywordInput(2), { target: { value: '  ' } })
      fireEvent.click(saveButton())

      expect(onSave.mock.calls[0][0].keywords).toEqual([
        { id: 'k-1', keyword: 'finale', wholeWord: true },
        { id: 'k-2', keyword: '', wholeWord: false, _destroy: true }
      ])
    })

    it('sends an edited keyword and toggled whole-word flag against the same id', () => {
      const { onSave } = renderEditor({ initial: existingFilter() })

      fireEvent.change(keywordInput(1), { target: { value: 'season finale' } })
      fireEvent.click(
        screen.getByRole('switch', { name: /Whole word for season finale/ })
      )
      fireEvent.click(saveButton())

      expect(onSave.mock.calls[0][0].keywords[0]).toEqual({
        id: 'k-1',
        keyword: 'season finale',
        wholeWord: false
      })
    })

    it.each([
      { description: 'never expires', expiresInMs: null, expected: '0' },
      {
        description: 'expires in 20 minutes',
        expiresInMs: 20 * 60_000,
        expected: '1800'
      },
      {
        description: 'expires in 2 hours',
        expiresInMs: 2 * 3_600_000,
        expected: '21600'
      }
    ])(
      'preselects the smallest expiry option covering the remaining time when it $description',
      ({ expiresInMs, expected }) => {
        const now = Date.parse('2026-01-01T00:00:00Z')
        renderEditor({
          initial: existingFilter({
            expires_at:
              expiresInMs === null
                ? null
                : new Date(now + expiresInMs).toISOString()
          }),
          currentTime: now
        })

        expect(screen.getByLabelText('Expire after')).toHaveValue(expected)
      }
    )

    it('caps at the longest option (1 week) when the remaining time is longer', () => {
      const now = Date.parse('2026-01-01T00:00:00Z')
      renderEditor({
        initial: existingFilter({
          expires_at: new Date(now + 30 * 86_400_000).toISOString()
        }),
        currentTime: now
      })

      expect(screen.getByLabelText('Expire after')).toHaveValue('604800')
    })
  })

  describe('action cards', () => {
    it('moves the selection with the arrow keys and wraps around', () => {
      renderEditor()
      const warn = screen.getByRole('radio', { name: /Hide with a warning/ })
      const hide = screen.getByRole('radio', { name: /Hide completely/ })

      fireEvent.keyDown(warn, { key: 'ArrowRight' })
      expect(hide).toHaveAttribute('aria-checked', 'true')
      expect(hide).toHaveFocus()

      fireEvent.keyDown(hide, { key: 'ArrowDown' })
      expect(warn).toHaveAttribute('aria-checked', 'true')

      fireEvent.keyDown(warn, { key: 'ArrowLeft' })
      expect(hide).toHaveAttribute('aria-checked', 'true')
    })

    it('ignores keys that are not arrows', () => {
      renderEditor()

      fireEvent.keyDown(
        screen.getByRole('radio', { name: /Hide with a warning/ }),
        {
          key: 'a'
        }
      )

      expect(
        screen.getByRole('radio', { name: /Hide with a warning/ })
      ).toHaveAttribute('aria-checked', 'true')
    })

    it.each([
      {
        scope: 'account' as const,
        hint: /never reach your feeds or notifications/
      },
      {
        scope: 'server' as const,
        hint: /dropped server-side and never delivered/
      }
    ])('words the hide hint for the $scope scope', ({ scope, hint }) => {
      renderEditor({ scope })

      expect(
        screen.getByRole('radio', { name: /Hide completely/ })
      ).toHaveTextContent(hint)
    })

    it('updates the warn preview as the title is typed', () => {
      renderEditor()

      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Politics' }
      })

      expect(screen.getByText('Filtered: Politics')).toBeInTheDocument()
    })
  })

  describe('feedback and navigation', () => {
    it('shows the save error', () => {
      renderEditor({ error: 'Failed to create filter. Please try again.' })

      expect(
        screen.getByText('Failed to create filter. Please try again.')
      ).toBeInTheDocument()
    })

    it('disables saving and going back while a save is in flight', () => {
      renderEditor({ initial: existingFilter(), saving: true })

      expect(saveButton()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    })

    it('calls onCancel from the Back button', () => {
      const { onCancel, onSave } = renderEditor({ initial: existingFilter() })

      fireEvent.click(screen.getByRole('button', { name: 'Back' }))

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(onSave).not.toHaveBeenCalled()
    })

    it('prompts to add a keyword when an edited filter has none left', () => {
      renderEditor({ initial: existingFilter({ keywords: [] }) })

      expect(screen.getByText(/No keywords yet/)).toBeInTheDocument()
      expect(saveButton()).toBeDisabled()
    })
  })
})
