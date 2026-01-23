/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { MediaManagement } from './MediaManagement'

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn()
  }))
}))

describe('MediaManagement', () => {
  describe('post link generation', () => {
    it('generates correct link for local actor', () => {
      const medias = [
        {
          id: 'media-1',
          actorId: 'https://example.com/users/alice',
          bytes: 1024,
          mimeType: 'image/png',
          width: 800,
          height: 600,
          url: '/api/v1/files/test.png',
          statusId: 'https://example.com/users/alice/statuses/123'
        }
      ]

      render(
        <MediaManagement
          used={1024}
          limit={10485760}
          medias={medias}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      const link = screen.getByText('View in post →')
      expect(link).toHaveAttribute(
        'href',
        '/@alice@example.com/https%3A%2F%2Fexample.com%2Fusers%2Falice%2Fstatuses%2F123'
      )
    })

    it('generates correct link for remote actor with different domain', () => {
      const medias = [
        {
          id: 'media-2',
          actorId: 'https://remote-instance.social/users/bob',
          bytes: 2048,
          mimeType: 'image/jpeg',
          width: 1024,
          height: 768,
          url: '/api/v1/files/test2.jpg',
          statusId: 'https://remote-instance.social/users/bob/statuses/456'
        }
      ]

      render(
        <MediaManagement
          used={2048}
          limit={10485760}
          medias={medias}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      const link = screen.getByText('View in post →')
      expect(link).toHaveAttribute(
        'href',
        '/@bob@remote-instance.social/https%3A%2F%2Fremote-instance.social%2Fusers%2Fbob%2Fstatuses%2F456'
      )
    })

    it('does not show link when statusId is undefined', () => {
      const medias = [
        {
          id: 'media-3',
          actorId: 'https://example.com/users/charlie',
          bytes: 512,
          mimeType: 'image/png',
          width: 400,
          height: 300,
          url: '/api/v1/files/test3.png'
        }
      ]

      render(
        <MediaManagement
          used={512}
          limit={10485760}
          medias={medias}
          currentPage={1}
          itemsPerPage={25}
          totalItems={1}
        />
      )

      const link = screen.queryByText('View in post →')
      expect(link).not.toBeInTheDocument()
    })
  })
})
