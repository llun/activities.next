/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Attachment } from '@/lib/types/domain/attachment'

import { Media } from './media'

// Mock BlurhashCanvas to easily assert its rendering
vi.mock('./BlurhashCanvas', () => ({
  BlurhashCanvas: ({
    blurhash,
    className,
    style
  }: {
    blurhash: string
    className?: string
    style?: React.CSSProperties
  }) => (
    <div
      data-testid="blurhash-canvas"
      data-blurhash={blurhash}
      className={className}
      style={style}
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

  it('renders BlurhashCanvas and transitions opacity when image loads', () => {
    const attachmentWithBlurhash: Attachment = {
      ...baseAttachment,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: -1, y: 1 }
    }

    const { container } = render(<Media attachment={attachmentWithBlurhash} />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ aspectRatio: '800 / 600' })

    const canvas = screen.getByTestId('blurhash-canvas')
    expect(canvas).toBeInTheDocument()
    expect(canvas).toHaveAttribute(
      'data-blurhash',
      'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    )
    expect(canvas).toHaveStyle({ objectPosition: '0% 0%' })
    expect(canvas.className).toContain('opacity-100')

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveStyle({ objectPosition: '0% 0%' })
    expect(img.className).toContain('opacity-0')

    // Simulate image load event
    fireEvent.load(img)

    expect(img.className).toContain('opacity-100')
    expect(canvas.className).toContain('opacity-0')
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
    // A poster alone must not defer the fetch. Only a strip item asks for that,
    // by passing `loading="lazy"`; every other caller — the lightbox, which
    // shows controls, and the lone-video branch — omits it and keeps the
    // element's own `metadata` default.
    expect(video).not.toHaveAttribute('preload')
  })
})
