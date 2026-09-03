/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { Attachment } from '@/lib/types/domain/attachment'

import { MediasModal } from './medias-modal'

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

describe('MediasModal', () => {
  it('renders alt text underneath image when description exists', () => {
    const attachment = buildAttachment({
      name: 'A mountaineer walking along a ridge'
    })

    render(
      <MediasModal
        medias={[attachment]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    const alts = screen.getAllByText('A mountaineer walking along a ridge')
    expect(alts[0]).toBeInTheDocument()
    expect(alts[0]).toHaveClass('text-white/85', 'text-sm')
  })

  it('does not render alt text paragraph when description is empty or whitespace', () => {
    const attachment = buildAttachment({
      name: '   '
    })

    const { container } = render(
      <MediasModal
        medias={[attachment]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('shows the corresponding alt text when navigating between media items', () => {
    const first = buildAttachment({
      id: 'attachment-1',
      name: 'First photo description'
    })
    const second = buildAttachment({
      id: 'attachment-2',
      name: 'Second photo description'
    })

    render(
      <MediasModal
        medias={[first, second]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    expect(screen.getByText('First photo description')).toBeInTheDocument()

    const secondThumbnail = screen.getByRole('button', {
      name: /Second photo description/i
    })
    fireEvent.click(secondThumbnail)

    expect(screen.getByText('Second photo description')).toBeInTheDocument()
  })
})
