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

  it('applies keyboard focus-visible outline classes on thumbnail buttons', () => {
    const attachment = buildAttachment({
      id: 'attachment-1',
      name: 'Cat'
    })

    render(
      <ActorMediaGallery
        actorId="https://activities.local/users/llun"
        initialAttachments={[attachment]}
      />
    )

    const button = screen.getByRole('button', {
      name: 'Open media: Cat'
    })
    expect(button).toHaveClass(
      'focus-visible:outline-2',
      'focus-visible:outline-offset-[-2px]',
      'focus-visible:outline-primary'
    )
  })

  it('renders engagement counts overlay with favorite, comment, and repost counts', () => {
    const attachment = buildAttachment({
      id: 'attachment-1',
      statusId: 'https://activities.local/users/llun/statuses/post-1'
    })

    const status = {
      id: 'https://activities.local/users/llun/statuses/post-1',
      url: 'https://activities.local/users/llun/statuses/post-1',
      actorId: 'https://activities.local/users/llun',
      actor: null,
      type: 'Note' as const,
      text: 'Photo post',
      to: [],
      cc: [],
      edits: [],
      reply: '',
      replies: [],
      totalReplies: 14,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 42,
      totalShares: 7,
      attachments: [attachment],
      tags: [],
      createdAt: currentTime,
      updatedAt: currentTime,
      isLocalActor: true
    }

    render(
      <ActorMediaGallery
        actorId="https://activities.local/users/llun"
        initialAttachments={[attachment]}
        statuses={[status]}
      />
    )

    const overlay = screen.getByTestId('media-overlay-attachment-1')
    expect(overlay).toBeInTheDocument()
    expect(screen.getByTitle('42 favorites')).toBeInTheDocument()
    expect(screen.getByTitle('14 comments')).toBeInTheDocument()
    expect(screen.getByTitle('7 reposts')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('renders album indicator for multi-photo statuses and video indicator for video attachments', () => {
    const photo1 = buildAttachment({
      id: 'photo-1',
      statusId: 'https://activities.local/users/llun/statuses/post-multi'
    })
    const photo2 = buildAttachment({
      id: 'photo-2',
      statusId: 'https://activities.local/users/llun/statuses/post-multi'
    })
    const video = buildAttachment({
      id: 'video-1',
      mediaType: 'video/mp4',
      statusId: 'https://activities.local/users/llun/statuses/post-video'
    })

    const multiStatus = {
      id: 'https://activities.local/users/llun/statuses/post-multi',
      url: 'https://activities.local/users/llun/statuses/post-multi',
      actorId: 'https://activities.local/users/llun',
      actor: null,
      type: 'Note' as const,
      text: 'Multi photo',
      to: [],
      cc: [],
      edits: [],
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      attachments: [photo1, photo2],
      tags: [],
      createdAt: currentTime,
      updatedAt: currentTime,
      isLocalActor: true
    }

    const videoStatus = {
      id: 'https://activities.local/users/llun/statuses/post-video',
      url: 'https://activities.local/users/llun/statuses/post-video',
      actorId: 'https://activities.local/users/llun',
      actor: null,
      type: 'Note' as const,
      text: 'Video post',
      to: [],
      cc: [],
      edits: [],
      reply: '',
      replies: [],
      totalReplies: 0,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 0,
      totalShares: 0,
      attachments: [video],
      tags: [],
      createdAt: currentTime,
      updatedAt: currentTime,
      isLocalActor: true
    }

    render(
      <ActorMediaGallery
        actorId="https://activities.local/users/llun"
        initialAttachments={[photo1, video]}
        statuses={[multiStatus, videoStatus]}
      />
    )

    expect(screen.getByTestId('album-indicator')).toBeInTheDocument()
    expect(screen.getByTestId('video-indicator')).toBeInTheDocument()
  })

  it('derives attachments from statuses and hides standalone load more button when isPixelfed is true', () => {
    const attachment = buildAttachment({
      id: 'pixelfed-att-1',
      name: 'Pixelfed photo'
    })

    const pixelfedStatus = {
      id: 'https://pixelfed.example/p/user/1',
      url: 'https://pixelfed.example/p/user/1',
      actorId: 'https://pixelfed.example/users/user',
      actor: null,
      type: 'Note' as const,
      text: 'Pixelfed photo',
      to: [],
      cc: [],
      edits: [],
      reply: '',
      replies: [],
      totalReplies: 2,
      actorAnnounceStatusId: null,
      isActorLiked: false,
      isActorBookmarked: false,
      totalLikes: 10,
      totalShares: 3,
      attachments: [attachment],
      tags: [],
      createdAt: currentTime,
      updatedAt: currentTime,
      isLocalActor: false
    }

    render(
      <ActorMediaGallery
        actorId="https://pixelfed.example/users/user"
        initialAttachments={[]}
        statuses={[pixelfedStatus]}
        isPixelfed={true}
      />
    )

    expect(
      screen.getByRole('button', { name: 'Open media: Pixelfed photo' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Load more')).not.toBeInTheDocument()
  })

  it('renders the gallery grid inside a framed card with reduced padding for both standard and Pixelfed profiles', () => {
    const attachment = buildAttachment({
      id: 'photo-1',
      name: 'Sample image'
    })

    const { container: standardContainer } = render(
      <ActorMediaGallery
        actorId="https://activities.local/users/llun"
        initialAttachments={[attachment]}
        isPixelfed={false}
      />
    )

    const standardFrame = standardContainer.querySelector(
      '.rounded-xl.border.bg-card.p-1.shadow-sm'
    )
    expect(standardFrame).toBeInTheDocument()
    expect(standardFrame).toHaveClass('sm:p-2')

    const { container: pixelfedContainer } = render(
      <ActorMediaGallery
        actorId="https://pixelfed.example/users/user"
        initialAttachments={[attachment]}
        isPixelfed={true}
      />
    )

    const pixelfedFrame = pixelfedContainer.querySelector(
      '.rounded-xl.border.bg-card.p-1.shadow-sm'
    )
    expect(pixelfedFrame).toBeInTheDocument()
    expect(pixelfedFrame).toHaveClass('sm:p-2')
  })

  it('merges custom className onto the framed card container', () => {
    const attachment = buildAttachment({ id: 'photo-1' })
    const { container } = render(
      <ActorMediaGallery
        actorId="https://activities.local/users/llun"
        initialAttachments={[attachment]}
        className="custom-test-class"
      />
    )

    const frame = container.querySelector(
      '.rounded-xl.border.bg-card.p-1.shadow-sm'
    )
    expect(frame).toHaveClass('custom-test-class')
  })
})
