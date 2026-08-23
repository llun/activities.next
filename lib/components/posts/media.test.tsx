/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Attachment } from '@/lib/types/domain/attachment'

import { Media } from './media'

// Mock BlurhashCanvas to easily assert its rendering
vi.mock('./BlurhashCanvas', () => ({
  BlurhashCanvas: ({
    blurhash,
    className
  }: {
    blurhash: string
    className?: string
  }) => (
    <div
      data-testid="blurhash-canvas"
      data-blurhash={blurhash}
      className={className}
    />
  )
}))

describe('Media', () => {
  const baseAttachment: Attachment = {
    id: 'att-1',
    actorId: 'actor-1',
    statusId: 'status-1',
    type: 'Document',
    mediaType: 'image/jpeg',
    url: 'https://example.com/image.jpg',
    width: 800,
    height: 600,
    name: 'An image',
    createdAt: 1000,
    updatedAt: 1000
  }

  it('renders standard image with default center object position', () => {
    render(<Media attachment={baseAttachment} />)

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/image.jpg')
    expect(img).toHaveStyle({ objectPosition: '50% 50%' })
    expect(screen.queryByTestId('blurhash-canvas')).not.toBeInTheDocument()
  })

  it('renders image with focal point object position', () => {
    const attachmentWithFocus: Attachment = {
      ...baseAttachment,
      focus: { x: -1, y: 1 } // Top-left -> 0% 0%
    }

    render(<Media attachment={attachmentWithFocus} />)

    const img = screen.getByRole('img')
    expect(img).toHaveStyle({ objectPosition: '0% 0%' })
  })

  it('renders BlurhashCanvas when blurhash is present', () => {
    const attachmentWithBlurhash: Attachment = {
      ...baseAttachment,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    }

    render(<Media attachment={attachmentWithBlurhash} />)

    const canvas = screen.getByTestId('blurhash-canvas')
    expect(canvas).toBeInTheDocument()
    expect(canvas).toHaveAttribute(
      'data-blurhash',
      'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    )

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
  })

  it('renders video with poster and focal point object position', () => {
    const videoAttachment: Attachment = {
      ...baseAttachment,
      mediaType: 'video/mp4',
      url: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      focus: { x: 0.5, y: -0.5 }
    }

    const { container } = render(<Media attachment={videoAttachment} />)

    const video = container.querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video).toHaveAttribute('poster', 'https://example.com/thumb.jpg')
    expect(video).toHaveStyle({ objectPosition: '75% 75%' })
  })
})
