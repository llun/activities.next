/**
 * @jest-environment jsdom
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

jest.mock('@/lib/client', () => ({
  addListAccounts: jest.fn(),
  createList: jest.fn(),
  deleteList: jest.fn(),
  removeListAccounts: jest.fn(),
  updateList: jest.fn()
}))

const mockPush = jest.fn()
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
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
    jest.clearAllMocks()
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

  it('adds a suggested account to the list right away', async () => {
    render(
      <ListEditor
        mode="edit"
        list={list}
        initialMembers={[]}
        followingSuggestions={[suggestion]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(addListAccounts).toHaveBeenCalledWith({
        listId: 'list-1',
        accountIds: [suggestion.id]
      })
    )
    // The added account moves from Suggestions into the member list.
    await waitFor(() =>
      expect(screen.getByText('In this list · 1')).toBeInTheDocument()
    )
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
