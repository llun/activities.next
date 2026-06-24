/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  addCollectionAccounts,
  createCollection,
  deleteCollection,
  removeCollectionAccounts,
  updateCollection
} from '@/lib/client'
import { CollectionEntity } from '@/lib/types/mastodon/collection'

import { CollectionEditor, CollectionMember } from './CollectionEditor'

vi.mock('@/lib/client', () => ({
  addCollectionAccounts: vi.fn(),
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  removeCollectionAccounts: vi.fn(),
  updateCollection: vi.fn()
}))

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh })
}))

const collection: CollectionEntity = {
  id: 'col-1',
  title: 'Fediverse builders',
  description: 'who I read',
  topic: 'fediverse',
  language: null,
  visibility: 'public',
  feed_enabled: true,
  size: 0
}

const member: CollectionMember = {
  id: 'https://activities.local/users/rin',
  name: 'Rin',
  handle: 'rin@fosstodon.org'
}

const suggestion: CollectionMember = {
  id: 'https://activities.local/users/ben',
  name: 'Ben Carter',
  handle: 'ben@llun.social'
}

describe('CollectionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(createCollection as jest.Mock).mockResolvedValue({
      ...collection,
      id: 'new-col'
    })
    ;(updateCollection as jest.Mock).mockResolvedValue(collection)
    ;(addCollectionAccounts as jest.Mock).mockResolvedValue(true)
    ;(removeCollectionAccounts as jest.Mock).mockResolvedValue(true)
    ;(deleteCollection as jest.Mock).mockResolvedValue(true)
  })

  it('creates a collection and routes to its member editor', async () => {
    render(<CollectionEditor mode="create" />)

    fireEvent.change(screen.getByLabelText('Collection name'), {
      target: { value: 'New crew' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create collection' }))

    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith({
        title: 'New crew',
        // Empty optional text fields are sent as null to clear them.
        description: null,
        topic: null,
        visibility: 'public',
        feedEnabled: true
      })
    )
    expect(mockPush).toHaveBeenCalledWith('/collections/new-col/edit')
  })

  it('blocks creation when the name is empty', async () => {
    render(<CollectionEditor mode="create" />)

    fireEvent.click(screen.getByRole('button', { name: 'Create collection' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please enter a collection name.'
    )
    expect(createCollection).not.toHaveBeenCalled()
  })

  it('sanitizes the topic to a bare hashtag before saving', async () => {
    render(<CollectionEditor mode="create" />)

    fireEvent.change(screen.getByLabelText('Collection name'), {
      target: { value: 'Crew' }
    })
    fireEvent.change(screen.getByLabelText('Topic'), {
      target: { value: '#foss dev!' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create collection' }))

    await waitFor(() =>
      expect(createCollection).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'fossdev' })
      )
    )
  })

  it('does not render the people section in create mode', () => {
    render(<CollectionEditor mode="create" />)
    expect(screen.queryByText('People')).not.toBeInTheDocument()
  })

  it('adds a suggested account right away', async () => {
    render(
      <CollectionEditor
        mode="edit"
        collection={collection}
        initialMembers={[]}
        followingSuggestions={[suggestion]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(addCollectionAccounts).toHaveBeenCalledWith({
        collectionId: 'col-1',
        accountIds: [suggestion.id]
      })
    )
    await waitFor(() =>
      expect(screen.getByText('In this collection · 1')).toBeInTheDocument()
    )
  })

  it('removes a member right away', async () => {
    render(
      <CollectionEditor
        mode="edit"
        collection={collection}
        initialMembers={[member]}
        followingSuggestions={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Remove Rin' }))

    await waitFor(() =>
      expect(removeCollectionAccounts).toHaveBeenCalledWith({
        collectionId: 'col-1',
        accountIds: [member.id]
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByText('In this collection · 1')
      ).not.toBeInTheDocument()
    )
  })

  it('saves changes and routes back to the collection', async () => {
    render(
      <CollectionEditor
        mode="edit"
        collection={collection}
        initialMembers={[member]}
      />
    )

    fireEvent.change(screen.getByLabelText('Collection name'), {
      target: { value: 'Renamed' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(updateCollection).toHaveBeenCalledWith({
        collectionId: 'col-1',
        title: 'Renamed',
        description: 'who I read',
        topic: 'fediverse',
        visibility: 'public',
        feedEnabled: true
      })
    )
    expect(mockPush).toHaveBeenCalledWith('/collections/col-1')
  })
})
