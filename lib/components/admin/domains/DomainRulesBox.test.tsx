/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { AdminRule } from '@/lib/services/rules/adminRule'

import { DomainRulesBox } from './DomainRulesBox'

const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockDelete = vi.fn()
const mockGet = vi.fn()

vi.mock('@/lib/client', () => ({
  createServerRule: (...args: unknown[]) => mockCreate(...args),
  updateServerRule: (...args: unknown[]) => mockUpdate(...args),
  deleteServerRule: (...args: unknown[]) => mockDelete(...args),
  getServerRules: (...args: unknown[]) => mockGet(...args)
}))

const rule = (overrides: Partial<AdminRule>): AdminRule => ({
  id: 'r1',
  domain: null,
  text: 'Be kind to everyone',
  hint: '',
  position: 0,
  ...overrides
})

const SERVER = [
  rule({ id: 's1', hint: 'No harassment or threats.' }),
  rule({ id: 's2', text: 'No spam or unsolicited ads', position: 1 })
]
const OWN = [
  rule({
    id: 'o1',
    domain: 'run.example',
    text: 'Share only routes you may share',
    position: 0
  }),
  rule({
    id: 'o2',
    domain: 'run.example',
    text: 'Keep home addresses private',
    position: 1
  })
]

const renderBox = (own = OWN) =>
  render(
    <DomainRulesBox
      domain="run.example"
      serverRules={SERVER}
      ownRules={own}
      readOnly={false}
    />
  )

const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))

describe('DomainRulesBox', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockUpdate.mockReset()
    mockDelete.mockReset()
    mockGet.mockReset()
  })

  it('lists the server rules read-only with an All domains chip, then the domain rules numbered after them', () => {
    renderBox()
    expect(screen.getByText('Be kind to everyone')).toBeInTheDocument()
    expect(screen.getByText('No harassment or threats.')).toBeInTheDocument()
    expect(screen.getAllByText('All domains')).toHaveLength(2)
    // Server rules cannot be edited here.
    expect(screen.queryByRole('textbox', { name: /Rule 1 text/ })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Rule 3 text' })).toHaveValue(
      'Share only routes you may share'
    )
    expect(screen.getByRole('textbox', { name: 'Rule 4 text' })).toHaveValue(
      'Keep home addresses private'
    )
    expect(
      screen.getByRole('heading', { name: 'Rules for run.example' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Server rules apply on every domain\./)
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Server rules' })).toHaveAttribute(
      'href',
      '/admin/rules'
    )
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled()
    expect(
      screen.getByText('Changes apply to run.example only.')
    ).toBeInTheDocument()
  })

  it('adds a rule to the draft and creates it for the domain on save', async () => {
    mockCreate.mockResolvedValue(
      rule({ id: 'o3', domain: 'run.example', text: 'No bots', position: 2 })
    )
    renderBox()
    fireEvent.change(screen.getByLabelText('New rule for run.example'), {
      target: { value: 'No bots' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('textbox', { name: 'Rule 5 text' })).toHaveValue(
      'No bots'
    )
    // Nothing is written until Save rules.
    expect(mockCreate).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    save()
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        domain: 'run.example',
        text: 'No bots',
        hint: '',
        position: 2
      })
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('edits a rule and sends only the changed text', async () => {
    mockUpdate.mockResolvedValue(
      rule({ id: 'o1', text: 'Share routes you may share', position: 0 })
    )
    renderBox()
    fireEvent.change(screen.getByRole('textbox', { name: 'Rule 3 text' }), {
      target: { value: 'Share routes you may share' }
    })
    save()
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('o1', {
        text: 'Share routes you may share'
      })
    )
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('removes a rule on save', async () => {
    mockDelete.mockResolvedValue(true)
    mockUpdate.mockImplementation(async (id, input) =>
      rule({ id, ...input, domain: 'run.example' })
    )
    renderBox()
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }))
    expect(
      screen.queryByDisplayValue('Share only routes you may share')
    ).toBeNull()
    expect(mockDelete).not.toHaveBeenCalled()
    save()
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('o1'))
    // The remaining rule moves up to position 0.
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('o2', { position: 0 })
    )
  })

  it('reorders with the keyboard and writes the changed positions', async () => {
    mockUpdate.mockImplementation(async (id, input) =>
      rule({ id, ...input, domain: 'run.example' })
    )
    renderBox()
    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Reorder rule 3: use arrow up and arrow down keys to move'
      }),
      { key: 'ArrowDown' }
    )
    expect(screen.getByRole('textbox', { name: 'Rule 3 text' })).toHaveValue(
      'Keep home addresses private'
    )
    save()
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('o2', { position: 0 })
      expect(mockUpdate).toHaveBeenCalledWith('o1', { position: 1 })
    })
  })

  it('does not take Enter as a new line in a rule', () => {
    renderBox()
    const field = screen.getByRole('textbox', { name: 'Rule 3 text' })
    expect(fireEvent.keyDown(field, { key: 'Enter' })).toBe(false)
  })

  it('will not save a rule with its text cleared', () => {
    renderBox()
    fireEvent.change(screen.getByRole('textbox', { name: 'Rule 3 text' }), {
      target: { value: '  ' }
    })
    expect(screen.getByText(/Every rule needs text/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeDisabled()
  })

  it('shows an error and keeps the unwritten rule on top of the server state when a write fails', async () => {
    mockCreate.mockResolvedValue(null)
    mockGet.mockResolvedValue(OWN)
    renderBox()
    fireEvent.change(screen.getByLabelText('New rule for run.example'), {
      target: { value: 'No bots' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    save()
    expect(
      await screen.findByText(
        'Failed to save the rules. Check the list and try again.'
      )
    ).toBeInTheDocument()
    expect(mockGet).toHaveBeenCalledWith('run.example')
    // The typed rule survives, and it is still unsaved.
    expect(screen.getByDisplayValue('No bots')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save rules' })).toBeEnabled()
  })

  it('does not create or delete twice on a retry after a failed save and a failed resync', async () => {
    mockDelete.mockResolvedValue(true)
    mockCreate
      .mockResolvedValueOnce(
        rule({ id: 'o3', domain: 'run.example', text: 'No bots', position: 1 })
      )
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        rule({ id: 'o4', domain: 'run.example', text: 'No ads', position: 2 })
      )
    mockUpdate.mockImplementation(async (id, input) =>
      rule({ id, ...input, domain: 'run.example' })
    )
    mockGet.mockRejectedValue(new Error('offline'))
    renderBox()
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }))
    for (const text of ['No bots', 'No ads']) {
      fireEvent.change(screen.getByLabelText('New rule for run.example'), {
        target: { value: text }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    }
    save()
    expect(
      await screen.findByText(
        'Failed to save the rules. Check the list and try again.'
      )
    ).toBeInTheDocument()
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledTimes(2)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save rules' })).toBeEnabled()
    )
    save()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    // The deleted rule is not deleted again, "No bots" is not created again,
    // and only "No ads" is.
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledTimes(3)
    expect(mockCreate).toHaveBeenLastCalledWith({
      domain: 'run.example',
      text: 'No ads',
      hint: '',
      position: 2
    })
  })

  it('moves focus to the next rule after removing one, else the add field', () => {
    renderBox()
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }))
    expect(screen.getByRole('textbox', { name: 'Rule 3 text' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }))
    expect(screen.getByLabelText('New rule for run.example')).toHaveFocus()
  })

  it('says the domain has no rules of its own yet', () => {
    renderBox([])
    expect(
      screen.getByText('run.example has no rules of its own yet.')
    ).toBeInTheDocument()
  })

  describe('primary domain', () => {
    it('shows only the server rules with a link to edit them', () => {
      render(
        <DomainRulesBox
          domain="social.example"
          serverRules={SERVER}
          ownRules={[]}
          readOnly
        />
      )
      expect(screen.getByText('Be kind to everyone')).toBeInTheDocument()
      expect(screen.queryByText('All domains')).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Save rules' })).toBeNull()
      expect(
        screen.getByText(
          'The primary domain has no rules of its own. These are the server rules.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Edit in Server rules' })
      ).toHaveAttribute('href', '/admin/rules')
    })
  })
})
