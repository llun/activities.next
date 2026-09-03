/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { Attachment } from '@/lib/types/domain/attachment'

import { ActorMediaGallery } from './ActorMediaGallery'

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const buildAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'attachment-1',
  actorId: 'https://activities.local/users/llun',
  statusId: 'https://activities.local/users/llun/statuses/post-1',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: 'https://activities.local/media/1.jpg',
  name: '',
  createdAt: currentTime,
  updatedAt: currentTime,
  ...overrides
})

describe('ActorMediaGallery', () => {
  it('renders an ALT badge on thumbnails with descriptions and none on undescribed ones', () => {
    const described = buildAttachment({
      id: 'attachment-1',
      name: 'Cat in the garden'
    })
    const undescribed = buildAttachment({
      id: 'attachment-2',
      name: ''
    })

    render(
      <ActorMediaGallery
        actorId="https://activities.local/users/llun"
        initialAttachments={[described, undescribed]}
      />
    )

    // Only one ALT badge should be rendered
    const altBadges = screen.getAllByText('ALT')
    expect(altBadges).toHaveLength(1)
  })

  it('opens MediasModal when a thumbnail is clicked and shows the alt text', () => {
    const attachment = buildAttachment({
      id: 'attachment-1',
      name: 'Cat in the garden'
    })

    render(
      <ActorMediaGallery
        actorId="https://activities.local/users/llun"
        initialAttachments={[attachment]}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Open media: Cat in the garden'
    })
    fireEvent.click(button)

    const descriptions = screen.getAllByText('Cat in the garden')
    expect(descriptions[0]).toBeInTheDocument()
  })
})
