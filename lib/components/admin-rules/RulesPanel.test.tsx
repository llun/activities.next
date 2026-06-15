/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  type ServerRule,
  createServerRule,
  deleteServerRule,
  getServerRules,
  updateServerRule
} from '@/lib/client'

import { RulesPanel } from './RulesPanel'

vi.mock('@/lib/client', () => ({
  getServerRules: vi.fn(),
  createServerRule: vi.fn(),
  updateServerRule: vi.fn(),
  deleteServerRule: vi.fn()
}))

const mockGet = getServerRules as jest.MockedFunction<typeof getServerRules>
const mockCreate = createServerRule as jest.MockedFunction<
  typeof createServerRule
>
const mockUpdate = updateServerRule as jest.MockedFunction<
  typeof updateServerRule
>
const mockDelete = deleteServerRule as jest.MockedFunction<
  typeof deleteServerRule
>

const rule = (over: Partial<ServerRule>): ServerRule => ({
  id: '1',
  text: 'Be kind',
  hint: '',
  position: 0,
  ...over
})

const seed: ServerRule[] = [
  rule({ id: '1', text: 'Be kind', position: 0 }),
  rule({ id: '2', text: 'No spam', hint: 'Repetitive promotion', position: 1 })
]

beforeEach(() => {
  vi.clearAllMocks()
  mockGet.mockResolvedValue(seed)
})

const renderPanel = async () => {
  render(<RulesPanel />)
  // Wait for the initial load to resolve so the seeded rules are rendered.
  expect(await screen.findByText('Be kind')).toBeInTheDocument()
}

describe('RulesPanel', () => {
  it('renders the loaded rules in order', async () => {
    await renderPanel()
    expect(screen.getByText('No spam')).toBeInTheDocument()
    expect(screen.getByText('Repetitive promotion')).toBeInTheDocument()
  })

  it('shows an empty state when there are no rules', async () => {
    mockGet.mockResolvedValue([])
    render(<RulesPanel />)
    expect(
      await screen.findByText(
        'No rules yet — add one to show it on the about page.'
      )
    ).toBeInTheDocument()
  })

  it('surfaces a load error instead of the empty state', async () => {
    mockGet.mockRejectedValue(new Error('boom'))
    render(<RulesPanel />)
    expect(
      await screen.findByText('Failed to load rules. Please try again.')
    ).toBeInTheDocument()
  })

  it('creates a rule with a trailing position and clears the input', async () => {
    mockCreate.mockResolvedValue(
      rule({ id: '3', text: 'No harassment', position: 2 })
    )
    await renderPanel()
    const input = screen.getByLabelText('New rule text')
    fireEvent.change(input, { target: { value: 'No harassment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        text: 'No harassment',
        hint: '',
        position: 2
      })
    )
    expect(await screen.findByText('No harassment')).toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('edits a rule inline and saves text and hint', async () => {
    mockUpdate.mockResolvedValue(
      rule({
        id: '1',
        text: 'Be excellent',
        hint: 'To each other',
        position: 0
      })
    )
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule 1' }))
    fireEvent.change(screen.getByLabelText('Rule text'), {
      target: { value: 'Be excellent' }
    })
    fireEvent.change(screen.getByLabelText('Rule hint'), {
      target: { value: 'To each other' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('1', {
        text: 'Be excellent',
        hint: 'To each other'
      })
    )
    expect(await screen.findByText('Be excellent')).toBeInTheDocument()
  })

  it('saves the inline edit when the editor form is submitted', async () => {
    mockUpdate.mockResolvedValue(
      rule({ id: '1', text: 'Be kinder', hint: '', position: 0 })
    )
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule 1' }))
    const textField = screen.getByLabelText('Rule text')
    fireEvent.change(textField, { target: { value: 'Be kinder' } })
    // Submitting the form (e.g. pressing Enter in the text field) saves.
    fireEvent.submit(textField.closest('form') as HTMLFormElement)
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith('1', {
        text: 'Be kinder',
        hint: ''
      })
    )
    expect(await screen.findByText('Be kinder')).toBeInTheDocument()
  })

  it('cancels the inline edit when Escape is pressed', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule 1' }))
    const textField = screen.getByLabelText('Rule text')
    fireEvent.change(textField, { target: { value: 'changed' } })
    fireEvent.keyDown(textField, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByLabelText('Rule text')).not.toBeInTheDocument()
    )
    // The editor closed without saving; the original text is still shown.
    expect(screen.getByText('Be kind')).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('keeps the editor Save and Cancel enabled while editing', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule 1' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('surfaces an error and keeps the input when creating fails', async () => {
    mockCreate.mockResolvedValue(null)
    await renderPanel()
    const input = screen.getByLabelText('New rule text')
    fireEvent.change(input, { target: { value: 'No doxxing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(
      await screen.findByText('Failed to create rule. Please try again.')
    ).toBeInTheDocument()
    // The typed text is preserved so the admin can retry.
    expect(input).toHaveValue('No doxxing')
  })

  it('locks other list actions while a rule is being edited', async () => {
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule 1' }))
    // The other row's Edit/Delete, both reorder grips, and the Add controls
    // are disabled so the open editor's draft can't be discarded.
    expect(screen.getByRole('button', { name: 'Edit rule 2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete rule 2' })).toBeDisabled()
    screen
      .getAllByRole('button', { name: /^Reorder rule/ })
      .forEach((grip) => expect(grip).toBeDisabled())
    expect(screen.getByLabelText('New rule text')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
  })

  it('deletes a rule optimistically', async () => {
    mockDelete.mockResolvedValue(true)
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Delete rule 1' }))
    await waitFor(() =>
      expect(screen.queryByText('Be kind')).not.toBeInTheDocument()
    )
    expect(mockDelete).toHaveBeenCalledWith('1')
  })

  it('restores the rule when a delete fails', async () => {
    mockDelete.mockResolvedValue(false)
    await renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Delete rule 1' }))
    expect(
      await screen.findByText('Failed to delete rule. Please try again.')
    ).toBeInTheDocument()
    expect(screen.getByText('Be kind')).toBeInTheDocument()
  })

  it('reorders rules with the keyboard and persists new positions', async () => {
    mockUpdate.mockImplementation(async (id, input) =>
      rule({ id, position: input.position })
    )
    await renderPanel()
    // Move the first rule ("Be kind") down one slot.
    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Reorder rule 1: use arrow up and arrow down keys to move'
      }),
      { key: 'ArrowDown' }
    )
    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith('2', { position: 0 })
      expect(mockUpdate).toHaveBeenCalledWith('1', { position: 1 })
    })
    // "No spam" now sits above "Be kind" in document order.
    const beKind = screen.getByText('Be kind')
    const noSpam = screen.getByText('No spam')
    expect(
      noSpam.compareDocumentPosition(beKind) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('resyncs from the server when a reorder write fails', async () => {
    mockUpdate.mockResolvedValue(null)
    const serverOrder: ServerRule[] = [
      rule({ id: '2', text: 'No spam', position: 0 }),
      rule({ id: '1', text: 'Be kind', position: 1 })
    ]
    // First call is the initial load; second is the post-failure resync.
    mockGet.mockResolvedValueOnce(seed).mockResolvedValueOnce(serverOrder)
    await renderPanel()
    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Reorder rule 1: use arrow up and arrow down keys to move'
      }),
      { key: 'ArrowDown' }
    )
    expect(
      await screen.findByText('Failed to reorder rules. Please try again.')
    ).toBeInTheDocument()
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2))
  })

  it('does not persist when reordering past the list boundary', async () => {
    await renderPanel()
    // ArrowUp on the first rule is a no-op — nothing to move it above.
    fireEvent.keyDown(
      screen.getByRole('button', {
        name: 'Reorder rule 1: use arrow up and arrow down keys to move'
      }),
      { key: 'ArrowUp' }
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
