/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  approveCollectionMembership,
  revokeCollectionMembership
} from '@/lib/client'

import { CollectionConsentNotification } from './CollectionConsentNotification'

vi.mock('@/lib/client', () => ({
  approveCollectionMembership: vi.fn(),
  revokeCollectionMembership: vi.fn()
}))

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh })
}))

const props = {
  collectionId: 'col-1',
  collectionTitle: 'Fediverse builders',
  accountId: 'me'
}

describe('CollectionConsentNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(approveCollectionMembership as jest.Mock).mockResolvedValue(true)
    ;(revokeCollectionMembership as jest.Mock).mockResolvedValue(true)
  })

  it('shows the collection title and both consent actions', () => {
    render(<CollectionConsentNotification {...props} />)
    expect(screen.getByText('Fediverse builders')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /show me publicly/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /keep me hidden/i })
    ).toBeInTheDocument()
  })

  it('approves the caller’s own membership and reflects the featured state', async () => {
    render(<CollectionConsentNotification {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /show me publicly/i }))

    await waitFor(() =>
      expect(approveCollectionMembership).toHaveBeenCalledWith({
        collectionId: 'col-1',
        accountId: 'me'
      })
    )
    expect(await screen.findByText('Featured publicly')).toBeInTheDocument()
  })

  it('revokes the caller’s own membership and reflects the hidden state', async () => {
    render(<CollectionConsentNotification {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /keep me hidden/i }))

    await waitFor(() =>
      expect(revokeCollectionMembership).toHaveBeenCalledWith({
        collectionId: 'col-1',
        accountId: 'me'
      })
    )
    expect(await screen.findByText('Hidden')).toBeInTheDocument()
  })

  it('surfaces an inline error when the request fails', async () => {
    ;(approveCollectionMembership as jest.Mock).mockResolvedValue(false)
    render(<CollectionConsentNotification {...props} />)

    fireEvent.click(screen.getByRole('button', { name: /show me publicly/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update your choice. Please try again.'
    )
  })
})
