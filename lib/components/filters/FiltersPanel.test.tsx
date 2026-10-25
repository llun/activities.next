/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'

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

// The header action; the empty state offers a second "Add filter" below it.
const addButton = () => screen.getAllByRole('button', { name: 'Add filter' })[0]

const deleteButton = (title: string) =>
  screen.getByRole('button', { name: `Delete filter ${title}` })

const openFilterMenu = (name: string) =>
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'ArrowDown' })

const fillAndSaveNewFilter = (title: string, keyword: string) => {
  fireEvent.click(addButton())
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: title } })
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Keyword or phrase 1' }),
    { target: { value: keyword } }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('FiltersPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient.getFilters.mockResolvedValue([])
    mockClient.getServerFilters.mockResolvedValue([])
  })

  describe('listing', () => {
    it('shows a loading status, then the account filters as one list', async () => {
      mockClient.getFilters.mockResolvedValue([
        makeFilter(),
        makeFilter({ id: 'f-2', title: 'Politics' })
      ])

      renderPanel()

      expect(screen.getByRole('status')).toHaveTextContent('Loading filters')
      expect(screen.queryByText('Spoilers')).not.toBeInTheDocument()
      expect(await screen.findByText('Spoilers')).toBeInTheDocument()
      expect(screen.getByText('Politics')).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'Filters' })).toBeInTheDocument()
      expect(screen.queryByText('Loading filters')).toBeNull()
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

      expect(await screen.findByText('No filters yet')).toBeInTheDocument()
      expect(
        screen.getByText('Add one to start hiding unwanted posts.')
      ).toBeInTheDocument()
    })

    it('opens the editor from the empty state action', async () => {
      renderPanel()
      await screen.findByText('No filters yet')

      // The header and the empty state both offer the action.
      const [, emptyStateAction] = screen.getAllByRole('button', {
        name: 'Add filter'
      })
      fireEvent.click(emptyStateAction)

      expect(
        await screen.findByRole('heading', { name: 'Add filter' })
      ).toBeInTheDocument()
    })

    it('shows an alert instead of the empty state when loading fails', async () => {
      mockClient.getFilters.mockRejectedValue(new Error('offline'))

      renderPanel()

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to load filters. Please try again.'
      )
      expect(screen.queryByText(/No filters yet/)).not.toBeInTheDocument()
    })

    it('refetches and lists the filters when Retry is pressed after a failed load', async () => {
      mockClient.getFilters.mockRejectedValueOnce(new Error('network'))
      mockClient.getFilters.mockResolvedValueOnce([makeFilter()])

      renderPanel()
      await screen.findByRole('alert')

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(await screen.findByText('Spoilers')).toBeInTheDocument()
      expect(mockClient.getFilters).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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
      expect(
        screen
          .getByText('How server filters behave')
          .closest('[data-slot="alert"]')
      ).toHaveAttribute('data-tone', 'info')
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
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
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
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      )
      fireEvent.click(screen.getByRole('link', { name: 'Back to filters' }))
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
      pending.resolve(makeFilter({ id: 'f-new', title: 'Politics' }))
      expect(await screen.findByText('Politics')).toBeInTheDocument()
    })

    it('returns to the list without calling the API when the editor is cancelled', async () => {
      renderPanel()
      await screen.findByText(/No filters yet/)

      fireEvent.click(addButton())
      fireEvent.click(screen.getByRole('link', { name: 'Back to filters' }))

      expect(screen.getByText(/No filters yet/)).toBeInTheDocument()
      expect(mockClient.createFilter).not.toHaveBeenCalled()
    })

    it('clears a previous save error when the editor is reopened', async () => {
      mockClient.createFilter.mockResolvedValue(null)
      renderPanel()
      await screen.findByText(/No filters yet/)
      fillAndSaveNewFilter('Politics', 'election')
      await screen.findByText('Failed to create filter. Please try again.')

      fireEvent.click(screen.getByRole('link', { name: 'Back to filters' }))
      fireEvent.click(addButton())

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
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

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
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Spam v2' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(await screen.findByText('Spam v2')).toBeInTheDocument()
      expect(mockClient.updateServerFilter).toHaveBeenCalledWith(
        's-1',
        expect.objectContaining({ title: 'Spam v2' })
      )
      expect(mockClient.updateFilter).not.toHaveBeenCalled()
    })

    it('keeps the editor open with an error when the update is rejected', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])
      mockClient.updateFilter.mockResolvedValue(null)
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(editButton())
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Spoilers (TV)' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      expect(
        await screen.findByText('Failed to save changes. Please try again.')
      ).toBeInTheDocument()
      expect(screen.getByLabelText('Title')).toHaveValue('Spoilers (TV)')
    })

    it('leaves the list unchanged when editing is cancelled', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])
      renderPanel()
      await screen.findByText('Spoilers')

      fireEvent.click(editButton())
      fireEvent.change(screen.getByLabelText('Title'), {
        target: { value: 'Changed' }
      })
      fireEvent.click(screen.getByRole('link', { name: 'Back to filters' }))

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
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Failed to delete filter. Please try again.'
        )
        // A failed delete is not a failed load, so it offers no Retry.
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
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
      expect(addButton()).toBeDisabled()

      pending.resolve(true)
      await waitFor(() => expect(deleteButton('Politics')).toBeEnabled())
      expect(addButton()).toBeEnabled()
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

  describe('server list filters', () => {
    it('narrows the server list by action', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({ id: 's-warn', title: 'Warn rule', filter_action: 'warn' }),
        makeFilter({ id: 's-blur', title: 'Blur rule', filter_action: 'blur' }),
        makeFilter({ id: 's-hide', title: 'Hide rule', filter_action: 'hide' })
      ])

      renderPanel('server')
      expect(await screen.findByText('Warn rule')).toBeInTheDocument()
      openFilterMenu('Any action')

      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: 'Blur' })
      )

      expect(await screen.findByText('Blur rule')).toBeInTheDocument()
      expect(screen.queryByText('Warn rule')).not.toBeInTheDocument()
      expect(screen.queryByText('Hide rule')).not.toBeInTheDocument()
    })

    it('returns focus to a server filter chip after clearing it', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({
          id: 's-expired',
          title: 'Expired rule',
          expires_at: '2025-12-31T23:59:59.000Z'
        })
      ])

      renderPanel('server')
      expect(await screen.findByText('Expired rule')).toBeInTheDocument()
      openFilterMenu('Any status')
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: 'Expired' })
      )

      const trigger = screen.getByRole('button', { name: 'Status: Expired' })
      fireEvent.click(
        screen.getByRole('button', { name: 'Clear Expired filter' })
      )

      expect(screen.getByRole('button', { name: 'Any status' })).toBe(trigger)
      expect(document.activeElement).toBe(trigger)
    })

    it('matches the union of two selected contexts', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({
          id: 's-home',
          title: 'Home rule',
          context: ['home']
        }),
        makeFilter({
          id: 's-public',
          title: 'Public rule',
          context: ['public']
        }),
        makeFilter({
          id: 's-notifications',
          title: 'Notification rule',
          context: ['notifications']
        })
      ])

      renderPanel('server')
      expect(await screen.findByText('Home rule')).toBeInTheDocument()
      openFilterMenu('Any context')

      fireEvent.click(
        await screen.findByRole('menuitemcheckbox', { name: 'Home' })
      )
      expect(
        screen.getByRole('menuitemcheckbox', { name: 'Home' })
      ).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Public' }))

      expect(screen.getByText('Home rule')).toBeInTheDocument()
      expect(screen.getByText('Public rule')).toBeInTheDocument()
      expect(screen.queryByText('Notification rule')).not.toBeInTheDocument()
      const menu = screen.getByRole('menu')
      // Radix names the menu from its trigger; DropdownMenuContent's aria-label
      // is ignored when aria-labelledby is present.
      expect(menu).not.toHaveAttribute('aria-label')
      expect(menu).toHaveAccessibleName('Context: Home, Public')
    })

    it('uses currentTime to choose expired and active filters', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({
          id: 's-expired',
          title: 'Expired rule',
          expires_at: '2025-12-31T23:59:59.000Z'
        }),
        makeFilter({
          id: 's-active',
          title: 'Active rule',
          expires_at: '2026-01-01T00:00:01.000Z'
        }),
        makeFilter({ id: 's-never', title: 'No expiry rule' })
      ])

      renderPanel('server')
      expect(await screen.findByText('Expired rule')).toBeInTheDocument()
      openFilterMenu('Any status')
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: 'Expired' })
      )

      expect(screen.getByText('Expired rule')).toBeInTheDocument()
      expect(screen.queryByText('Active rule')).not.toBeInTheDocument()
      expect(screen.queryByText('No expiry rule')).not.toBeInTheDocument()

      openFilterMenu('Status: Expired')
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: 'Active' })
      )

      expect(screen.getByText('Active rule')).toBeInTheDocument()
      expect(screen.getByText('No expiry rule')).toBeInTheDocument()
      expect(screen.queryByText('Expired rule')).not.toBeInTheDocument()
    })

    it('clears all criteria and restores the full server list', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({
          id: 's-warn',
          title: 'Warn home rule',
          filter_action: 'warn',
          context: ['home']
        }),
        makeFilter({
          id: 's-hide',
          title: 'Hide public rule',
          filter_action: 'hide',
          context: ['public'],
          expires_at: '2026-01-02T00:00:00.000Z'
        }),
        makeFilter({
          id: 's-expired',
          title: 'Expired public rule',
          filter_action: 'hide',
          context: ['public'],
          expires_at: '2025-12-31T23:59:59.000Z'
        })
      ])

      renderPanel('server')
      expect(await screen.findByText('Warn home rule')).toBeInTheDocument()
      openFilterMenu('Any action')
      fireEvent.click(
        await screen.findByRole('menuitemradio', {
          name: 'Hide completely'
        })
      )
      expect(screen.queryByText('Warn home rule')).not.toBeInTheDocument()
      expect(screen.getByText('Hide public rule')).toBeInTheDocument()
      expect(screen.getByText('Expired public rule')).toBeInTheDocument()

      openFilterMenu('Any context')
      fireEvent.click(
        await screen.findByRole('menuitemcheckbox', { name: 'Public' })
      )
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
      openFilterMenu('Any status')
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: 'Active' })
      )

      expect(screen.getByText('Hide public rule')).toBeInTheDocument()
      expect(screen.queryByText('Expired public rule')).not.toBeInTheDocument()

      fireEvent.click(
        screen.getAllByRole('button', { name: 'Clear filters' })[0]
      )

      expect(screen.getByText('Warn home rule')).toBeInTheDocument()
      expect(screen.getByText('Hide public rule')).toBeInTheDocument()
      expect(screen.getByText('Expired public rule')).toBeInTheDocument()
      expect(screen.queryByText('No filters match')).not.toBeInTheDocument()
    })

    it('distinguishes no matching filters from an empty server list', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({ id: 's-warn', title: 'Warn rule', filter_action: 'warn' })
      ])

      renderPanel('server')
      expect(await screen.findByText('Warn rule')).toBeInTheDocument()
      openFilterMenu('Any action')
      fireEvent.click(
        await screen.findByRole('menuitemradio', {
          name: 'Hide completely'
        })
      )

      expect(await screen.findByText('No filters match')).toBeInTheDocument()
      expect(screen.queryByText('No filters yet')).not.toBeInTheDocument()
      const emptyState = screen
        .getByText('No filters match')
        .closest('[data-slot="empty-state"]')
      expect(
        within(emptyState as HTMLElement).getByRole('button', {
          name: 'Clear filters'
        })
      ).toBeInTheDocument()
      fireEvent.click(
        within(emptyState as HTMLElement).getByRole('button', {
          name: 'Clear filters'
        })
      )
      expect(screen.getByText('Warn rule')).toBeInTheDocument()
    })

    it('resets server filters after deleting the last filter before adding a new one', async () => {
      mockClient.getServerFilters.mockResolvedValue([
        makeFilter({
          id: 's-expired',
          title: 'Expired rule',
          expires_at: '2025-12-31T23:59:59.000Z'
        })
      ])
      mockClient.deleteServerFilter.mockResolvedValue(true)
      mockClient.createServerFilter.mockResolvedValue(
        makeFilter({
          id: 's-new',
          title: 'New active rule',
          expires_at: '2026-01-02T00:00:00.000Z',
          server: true
        })
      )

      renderPanel('server')
      expect(await screen.findByText('Expired rule')).toBeInTheDocument()
      openFilterMenu('Any status')
      fireEvent.click(
        await screen.findByRole('menuitemradio', { name: 'Expired' })
      )
      fireEvent.click(deleteButton('Expired rule'))
      expect(await screen.findByText('No filters yet')).toBeInTheDocument()
      await waitFor(() => expect(addButton()).toBeEnabled())

      fillAndSaveNewFilter('New active rule', 'new keyword')

      expect(await screen.findByText('New active rule')).toBeInTheDocument()
      expect(screen.queryByText('No filters match')).not.toBeInTheDocument()
    })

    it('shows the same controls in the phone filter sheet', async () => {
      mockClient.getServerFilters.mockResolvedValue([makeFilter()])
      renderPanel('server')
      await screen.findByText('Spoilers')

      fireEvent.click(screen.getByRole('button', { name: 'Filters' }))

      const dialog = await screen.findByRole('dialog', { name: 'Filters' })
      expect(
        within(dialog).getByRole('radiogroup', { name: 'Action' })
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('checkbox', { name: 'Home' })
      ).toBeInTheDocument()
      expect(
        within(dialog).getByRole('radiogroup', { name: 'Status' })
      ).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole('radio', { name: 'Blur' }))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))

      expect(screen.queryByText('Spoilers')).not.toBeInTheDocument()
      expect(screen.getByText('No filters match')).toBeInTheDocument()
    })

    it('does not show server filter controls in account scope', async () => {
      mockClient.getFilters.mockResolvedValue([makeFilter()])

      renderPanel('account')
      expect(await screen.findByText('Spoilers')).toBeInTheDocument()

      expect(
        screen.queryByRole('button', { name: 'Any action' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Any context' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Any status' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Filters' })
      ).not.toBeInTheDocument()
    })
  })
})
