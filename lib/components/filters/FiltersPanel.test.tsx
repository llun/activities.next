/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { ClientFilter, FilterInput } from '@/lib/client'
import { createDeferred } from '@/lib/testing/deferred'

import { FiltersPanel } from './FiltersPanel'

const mockClient = vi.hoisted(() => ({
  getFilters: vi.fn(),
  createFilter: vi.fn(),
  updateFilter: vi.fn(),
  deleteFilter: vi.fn(),
  getServerFilters: vi.fn(),
  createServerFilter: vi.fn(),
  updateServerFilter: vi.fn(),
  deleteServerFilter: vi.fn()
}))

vi.mock('@/lib/client', () => mockClient)

vi.mock('@/lib/components/page-header', () => ({
  PageHeader: ({
    title,
    description,
    actions
  }: {
    title: string
    description?: string
    actions?: React.ReactNode
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  )
}))

const NOW = Date.parse('2026-01-01T00:00:00Z')

const makeFilter = (overrides: Partial<ClientFilter> = {}): ClientFilter =>
  ({
    id: 'f-1',
    title: 'Spoilers',
    context: ['home'],
    filter_action: 'warn',
    expires_at: null,
    keywords: [{ id: 'k-1', keyword: 'finale', whole_word: true }],
    statuses: [],
    ...overrides
  }) as unknown as ClientFilter

const renderPanel = (scope: 'account' | 'server' = 'account') =>
  render(<FiltersPanel scope={scope} currentTime={NOW} />)

// The Edit buttons carry no per-filter label; these tests list one filter.
const editButton = () => screen.getByRole('button', { name: /Edit/ })

const deleteButton = (title: string) =>
  screen.getByRole('button', { name: `Delete filter ${title}` })

const fillAndSaveNewFilter = (title: string, keyword: string) => {
  fireEvent.click(screen.getByRole('button', { name: /Add new filter/ }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Keyword or phrase 1' }),
    { target: { value: keyword } }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Create filter' }))
}

describe('FiltersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient.getFilters.mockResolvedValue([])
    mockClient.getServerFilters.mockResolvedValue([])
  })

  describe('listing', () => {
    it('shows a loading message, then the account filters', async () => {
      mockClient.getFilters.mockResolvedValue([
        makeFilter(),
        makeFilter({ id: 'f-2', title: 'Politics' })
      ])

      renderPanel()

      expect(screen.getByText('Loading filters…')).toBeInTheDocument()
      expect(await screen.findByText('Spoilers')).toBeInTheDocument()
      expect(screen.getByText('Politics')).toBeInTheDocument()
      expect(screen.queryByText('Loading filters…')).not.toBeInTheDocument()
    })

    it('hides read-only server filters that the account endpoint merges in', async () => {
      mockClient.getFilters.mockResolvedValue([
        makeFilter(),
        makeFilter({ id: 's-1', title: 'Instance spam', server: true })
      ])

      renderPanel()

      expect(await screen.findByText('Spoilers')).toBeInTheDocument()
      expect(screen.queryByText('Instance spam')).not.toBeInTheDocument()
    })

    it('shows the empty state when there are no filters', async () => {
      renderPanel()

      expect(await screen.findByText(/No filters yet/)).toBeInTheDocument()
    })

    it('shows an error instead of the empty state when loading fails', async () => {
      mockClient.getFilters.mockRejectedValue(new Error('offline'))

      renderPanel()

      expect(
        await screen.findByText('Failed to load filters. Please try again.')
      ).toBeInTheDocument()
      expect(screen.queryByText(/No filters yet/)).not.toBeInTheDocument()
    })

    it('uses the instance-wide endpoints and explains server filters for the server scope', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({ id: 's-1', title: 'Instance spam', server: true })
      ])

      renderPanel('server')

      expect(await screen.findByText('Instance spam')).toBeInTheDocument()
      expect(mockClient.getServerFilters).toHaveBeenCalledTimes(1)
      expect(mockClient.getFilters).not.toHaveBeenCalled()
      expect(
        screen.getByRole('heading', { name: 'Server filters' })
      ).toBeInTheDocument()
      expect(screen.getByText('How server filters behave')).toBeInTheDocument()
    })

    it('does not show the server-filter explainer in the account scope', async () => {
      renderPanel()
      await screen.findByText(/No filters yet/)

      expect(
        screen.queryByText('How server filters behave')
      ).not.toBeInTheDocument()
    })
  })

  describe('creating', () => {
    it('opens the editor, saves through the API and appends the new filter to the list', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])
      mockClient.createFilter.mockResolvedValue(
        makeFilter({ id: 'f-new', title: 'Politics' })
      )
      renderPanel()
      await screen.findByText('Spoilers')

      fillAndSaveNewFilter('Politics', 'election')

      expect(await screen.findByText('Politics')).toBeInTheDocument()
      expect(mockClient.createFilter).toHaveBeenCalledWith({
        title: 'Politics',
        context: ['home'],
        filterAction: 'warn',
        expiresIn: null,
        keywords: [{ keyword: 'election', wholeWord: true }]
      } satisfies FilterInput)
      const titles = screen
        .getAllByText(/^(Spoilers|Politics)$/)
        .map((node) => node.textContent)
      expect(titles).toEqual(['Spoilers', 'Politics'])
    })

    it('creates through the server API in the server scope', async () => {
      mockClient.createServerFilter.mockResolvedValue(
        makeFilter({ id: 's-new', title: 'Spam', server: true })
      )
      renderPanel('server')
      await screen.findByText(/No filters yet/)

      fillAndSaveNewFilter('Spam', 'free followers')

      expect(await screen.findByText('Spam')).toBeInTheDocument()
      expect(mockClient.createServerFilter).toHaveBeenCalledTimes(1)
      expect(mockClient.createFilter).not.toHaveBeenCalled()
    })

    it('stays in the editor with an error when the API rejects the new filter', async () => {
      mockClient.createFilter.mockResolvedValue(null)
      renderPanel()
      await screen.findByText(/No filters yet/)

      fillAndSaveNewFilter('Politics', 'election')

      expect(
        await screen.findByText('Failed to create filter. Please try again.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveValue('Politics')
      expect(
        screen.getByRole('button', { name: 'Create filter' })
      ).toBeEnabled()
    })

    it('shows the thrown message when the request fails at the network layer', async () => {
      mockClient.createFilter.mockRejectedValue(new Error('Network down'))
      renderPanel()
      await screen.findByText(/No filters yet/)

      fillAndSaveNewFilter('Politics', 'election')

      expect(await screen.findByText('Network down')).toBeInTheDocument()
    })

    it('shows a generic message when a non-Error is thrown', async () => {
      mockClient.createFilter.mockRejectedValue('boom')
      renderPanel()
      await screen.findByText(/No filters yet/)

      fillAndSaveNewFilter('Politics', 'election')

      expect(
        await screen.findByText('Failed to save filter. Please try again.')
      ).toBeInTheDocument()
    })

    it('disables the editor buttons while the save is in flight', async () => {
      const pending = createDeferred<ClientFilter | null>()
      mockClient.createFilter.mockReturnValue(pending.promise)
      renderPanel()
      await screen.findByText(/No filters yet/)

      fillAndSaveNewFilter('Politics', 'election')

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Create filter' })
        ).toBeDisabled()
      )
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      pending.resolve(makeFilter({ id: 'f-new', title: 'Politics' }))
      expect(await screen.findByText('Politics')).toBeInTheDocument()
    })

    it('returns to the list without calling the API when the editor is cancelled', async () => {
      renderPanel()
      await screen.findByText(/No filters yet/)

      fireEvent.click(screen.getByRole('button', { name: /Add new filter/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByText(/No filters yet/)).toBeInTheDocument()
      expect(mockClient.createFilter).not.toHaveBeenCalled()
    })

    it('clears a previous save error when the editor is reopened', async () => {
      mockClient.createFilter.mockResolvedValue(null)
      renderPanel()
      await screen.findByText(/No filters yet/)
      fillAndSaveNewFilter('Politics', 'election')
      await screen.findByText('Failed to create filter. Please try again.')

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      fireEvent.click(screen.getByRole('button', { name: /Add new filter/ }))

      expect(
        screen.queryByText('Failed to create filter. Please try again.')
      ).not.toBeInTheDocument()
    })
  })

  describe('editing', () => {
    it('opens the editor with the filter, saves by id and shows the updated row', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])
      mockClient.updateFilter.mockResolvedValue(
        makeFilter({ title: 'Spoilers (TV)' })
      )
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(editButton())
      expect(screen.getByLabelText('Title')).toHaveValue('Spoilers')
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Spoilers (TV)' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(await screen.findByText('Spoilers (TV)')).toBeInTheDocument()
      expect(mockClient.updateFilter).toHaveBeenCalledWith('f-1', {
        title: 'Spoilers (TV)',
        context: ['home'],
        filterAction: 'warn',
        expiresIn: null,
        keywords: [{ id: 'k-1', keyword: 'finale', wholeWord: true }]
      } satisfies FilterInput)
      expect(screen.queryByText('Spoilers')).not.toBeInTheDocument()
    })

    it('updates through the server API in the server scope', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({ id: 's-1', title: 'Spam', server: true })
      ])
      mockClient.updateServerFilter.mockResolvedValue(
        makeFilter({ id: 's-1', title: 'Spam v2', server: true })
      )
      renderPanel('server')
      await screen.findByText('Spam')

      fireEvent.click(editButton())
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(await screen.findByText('Spam v2')).toBeInTheDocument()
      expect(mockClient.updateServerFilter).toHaveBeenCalledWith(
        's-1',
        expect.objectContaining({ title: 'Spam' })
      )
      expect(mockClient.updateFilter).not.toHaveBeenCalled()
    })

    it('keeps the editor open with an error when the update is rejected', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])
      mockClient.updateFilter.mockResolvedValue(null)
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(editButton())
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      expect(
        await screen.findByText('Failed to save changes. Please try again.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveValue('Spoilers')
    })

    it('leaves the list unchanged when editing is cancelled', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(editButton())
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Changed' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Back' }))

      expect(screen.getByText('Spoilers')).toBeInTheDocument()
      expect(mockClient.updateFilter).not.toHaveBeenCalled()
    })
  })

  describe('deleting', () => {
    it('removes the row and calls the API with the filter id', async () => {
      mockClient.getFilters.mockResolvedValue([
        makeFilter(),
        makeFilter({ id: 'f-2', title: 'Politics' })
      ])
      mockClient.deleteFilter.mockResolvedValue(true)
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(deleteButton('Spoilers'))

      await waitFor(() =>
        expect(screen.queryByText('Spoilers')).not.toBeInTheDocument()
      )
      expect(mockClient.deleteFilter).toHaveBeenCalledWith('f-1')
      expect(screen.getByText('Politics')).toBeInTheDocument()
    })

    it('deletes through the server API in the server scope', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({ id: 's-1', title: 'Spam', server: true })
      ])
      mockClient.deleteServerFilter.mockResolvedValue(true)
      renderPanel('server')
      await screen.findByText('Spam')

      fireEvent.click(deleteButton('Spam'))

      await waitFor(() =>
        expect(screen.queryByText('Spam')).not.toBeInTheDocument()
      )
      expect(mockClient.deleteServerFilter).toHaveBeenCalledWith('s-1')
      expect(mockClient.deleteFilter).not.toHaveBeenCalled()
    })

    it.each([
      {
        description: 'the API reports failure',
        arrange: () => mockClient.deleteFilter.mockResolvedValue(false)
      },
      {
        description: 'the request throws',
        arrange: () =>
          mockClient.deleteFilter.mockRejectedValue(new Error('offline'))
      }
    ])(
      'puts the row back and shows an error when $description',
      async ({ arrange }) => {
        mockClient.getFilters.mockResolvedValue([makeFilter()])
        arrange()
        renderPanel()
        await screen.findByText('Spoilers')

        fireEvent.click(deleteButton('Spoilers'))

        expect(
          await screen.findByText('Failed to delete filter. Please try again.')
        ).toBeInTheDocument()
        expect(screen.getByText('Spoilers')).toBeInTheDocument()
        expect(deleteButton('Spoilers')).toBeEnabled()
      }
    )

    it('freezes edit, delete and add while a delete is in flight, and unfreezes afterwards', async () => {
      const pending = createDeferred<boolean>()
      mockClient.getFilters.mockResolvedValue([
        makeFilter(),
        makeFilter({ id: 'f-2', title: 'Politics' })
      ])
      mockClient.deleteFilter.mockReturnValue(pending.promise)
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(deleteButton('Spoilers'))

      await waitFor(() => expect(deleteButton('Politics')).toBeDisabled())
      for (const edit of screen.getAllByRole('button', { name: /Edit/ })) {
        expect(edit).toBeDisabled()
      }
      expect(
        screen.getByRole('button', { name: /Add new filter/ })
      ).toBeDisabled()

      pending.resolve(true)
      await waitFor(() => expect(deleteButton('Politics')).toBeEnabled())
      expect(
        screen.getByRole('button', { name: /Add new filter/ })
      ).toBeEnabled()
    })

    it('shows the empty state after the last filter is deleted', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])
      mockClient.deleteFilter.mockResolvedValue(true)
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(deleteButton('Spoilers'))

      expect(await screen.findByText(/No filters yet/)).toBeInTheDocument()
    })
  })
})
