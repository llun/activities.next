/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  addListAccounts,
  createList,
  deleteList,
  removeListAccounts,
  updateList
} from '@/lib/client'
import { ListEntity } from '@/lib/types/mastodon/list'

import { ListEditor, ListMember } from './ListEditor'

vi.mock('@/lib/client', () => ({
  addListAccounts: vi.fn(),
  createList: vi.fn(),
  deleteList: vi.fn(),
  removeListAccounts: vi.fn(),
  updateList: vi.fn()
}))

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh })
}))

const list: ListEntity = {
  id: 'list-1',
  title: 'Running club',
  replies_policy: 'list',
  exclusive: false
}

const member: ListMember = {
  id: 'https://activities.local/users/rin',
  name: 'Rin',
  handle: 'rin@fosstodon.org'
}

const suggestion: ListMember = {
  id: 'https://activities.local/users/ben',
  name: 'Ben Carter',
  handle: 'ben@llun.social'
}

describe('ListEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createList as jest.Mock).mockResolvedValue({ ...list, id: 'new-list' })
    ;(updateList as jest.Mock).mockResolvedValue(list)
    ;(addListAccounts as jest.Mock).mockResolvedValue(true)
    ;(removeListAccounts as jest.Mock).mockResolvedValue(true)
    ;(deleteList as jest.Mock).mockResolvedValue(true)
  })

  it('creates a list and routes to its member editor', async () => {
    render(<ListEditor mode="create" />)

    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'New crew' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))

    await waitFor(() =>
      expect(createList).toHaveBeenCalledWith({
        title: 'New crew',
        repliesPolicy: 'list',
        exclusive: false
      })
    )
    expect(mockPush).toHaveBeenCalledWith('/lists/new-list/edit')
  })

  it('shows an inline error and re-enables save when create rejects', async () => {
    ;(createList as jest.Mock).mockRejectedValue(new Error('offline'))
    render(<ListEditor mode="create" />)

    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'New crew' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create the list. Please try again.'
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Create list' })
      ).not.toBeDisabled()
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('blocks creation when the name is empty', async () => {
    render(<ListEditor mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create list' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a list name.'
    )
    expect(createList).not.toHaveBeenCalled()
  })

  it('does not render the members section in create mode', () => {
    render(<ListEditor mode="create" />)
    expect(screen.queryByText('Members')).not.toBeInTheDocument()
  })

  it('adds a suggested account to the list via search dropdown', async () => {
    render(
      <ListEditor
        mode="edit"
        list={list}
        initialMembers={[]}
        followingSuggestions={[suggestion]}
      />
    )

    const searchInput = screen.getByLabelText('Search accounts you follow')
    fireEvent.change(searchInput, { target: { value: 'Ben' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(addListAccounts).toHaveBeenCalledWith({
        listId: 'list-1',
        accountIds: [suggestion.id]
      })
    )
    // The added account moves into the member list, search is cleared, and dropdown is closed.
    await waitFor(() =>
      expect(screen.getByText('In this list · 1')).toBeInTheDocument()
    )
    expect(searchInput).toHaveValue('')
    expect(
      screen.queryByRole('button', { name: 'Add' })
    ).not.toBeInTheDocument()
  })

  it('re-enables the Add button and shows an error when the request rejects', async () => {
    ;(addListAccounts as jest.Mock).mockRejectedValue(new Error('network down'))
    render(
      <ListEditor
        mode="edit"
        list={list}
        initialMembers={[]}
        followingSuggestions={[suggestion]}
      />
    )

    fireEvent.change(screen.getByLabelText('Search accounts you follow'), {
      target: { value: 'Ben' }
    })
    const addButton = screen.getByRole('button', { name: 'Add' })
    fireEvent.click(addButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not add that account. Please try again.'
    )
    // The pending state must clear even though the request threw, so the row's
    // Add button is usable again rather than stuck disabled.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add' })).not.toBeDisabled()
    )
  })

  it('limits suggestions in dropdown to 5 accounts', () => {
    const manySuggestions: ListMember[] = Array.from({ length: 8 }, (_, i) => ({
      id: `https://activities.local/users/user${i}`,
      name: `User ${i}`,
      handle: `user${i}@llun.social`
    }))

    render(
      <ListEditor
        mode="edit"
        list={list}
        initialMembers={[]}
        followingSuggestions={manySuggestions}
      />
    )

    fireEvent.change(screen.getByLabelText('Search accounts you follow'), {
      target: { value: 'User' }
    })

    const addButtons = screen.getAllByRole('button', { name: 'Add' })
    expect(addButtons).toHaveLength(5)
  })

  it('shows no accounts match message when query has no matches', () => {
    render(
      <ListEditor
        mode="edit"
        list={list}
        initialMembers={[]}
        followingSuggestions={[suggestion]}
      />
    )

    fireEvent.change(screen.getByLabelText('Search accounts you follow'), {
      target: { value: 'NonExistent' }
    })

    expect(
      screen.getByText('No accounts match your search.')
    ).toBeInTheDocument()
  })

  it('closes dropdown when pressing Escape', () => {
    render(
      <ListEditor
        mode="edit"
        list={list}
        initialMembers={[]}
        followingSuggestions={[suggestion]}
      />
    )

    const searchInput = screen.getByLabelText('Search accounts you follow')
    fireEvent.change(searchInput, { target: { value: 'Ben' } })
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()

    fireEvent.keyDown(searchInput, { key: 'Escape' })
    expect(
      screen.queryByRole('button', { name: 'Add' })
    ).not.toBeInTheDocument()
  })

  it('removes a member from the list right away', async () => {
    render(
      <ListEditor
        mode="edit"
        list={list}
        initialMembers={[member]}
        followingSuggestions={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove Rin' }))

    await waitFor(() =>
      expect(removeListAccounts).toHaveBeenCalledWith({
        listId: 'list-1',
        accountIds: [member.id]
      })
    )
    await waitFor(() =>
      expect(screen.queryByText('In this list · 1')).not.toBeInTheDocument()
    )
  })

  it('saves settings changes and routes back to the list', async () => {
    render(<ListEditor mode="edit" list={list} initialMembers={[member]} />)

    fireEvent.click(screen.getByLabelText('Hide members from Home'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateList).toHaveBeenCalledWith({
        listId: 'list-1',
        title: 'Running club',
        repliesPolicy: 'list',
        exclusive: true
      })
    )
    expect(mockPush).toHaveBeenCalledWith('/lists/list-1')
  })
})
