/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { getMediaPublicDetails } from '@/lib/client'
import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { Attachment } from '@/lib/types/domain/attachment'

import { MediasModal } from './medias-modal'

vi.mock('@/lib/client', () => ({
  getMediaPublicDetails: vi.fn()
}))

const TIME = new Date('2026-04-26T10:00:00.000Z').getTime()

const buildAttachment = (
  id: string,
  overrides: Partial<Attachment> = {}
): Attachment => ({
  id,
  actorId: 'https://activities.local/users/llun',
  statusId: 'https://activities.local/users/llun/statuses/post-1',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: `https://activities.local/media/${id}.jpg`,
  mediaId: `media-${id}`,
  name: `Alt ${id}`,
  createdAt: TIME,
  updatedAt: TIME,
  ...overrides
})

const renderModal = (
  medias: Attachment[],
  props: {
    initialSelection?: number
    onEdit?: (index: number) => void
  } = {}
) => {
  const ui = (list: Attachment[]) => (
    <PlaybackPreferencesProvider initialAutoplayGifs={false}>
      <MediasModal
        medias={list}
        initialSelection={props.initialSelection ?? 0}
        onClosed={vi.fn()}
        onEdit={props.onEdit}
      />
    </PlaybackPreferencesProvider>
  )
  const view = render(ui(medias))
  return { rerenderWith: (list: Attachment[]) => view.rerender(ui(list)) }
}

describe('MediasModal edit', () => {
  beforeEach(() => {
    vi.mocked(getMediaPublicDetails).mockReset()
    vi.mocked(getMediaPublicDetails).mockResolvedValue({
      subject: null,
      takenAt: null,
      camera: null,
      lens: null,
      exposure: null,
      place: null
    })
  })

  it('has no Edit button unless the viewer is given a handler', () => {
    renderModal([buildAttachment('1')])

    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit' })
    ).not.toBeInTheDocument()
  })

  it('puts Edit beside Details and reports the photo on screen', () => {
    const onEdit = vi.fn()
    renderModal([buildAttachment('1'), buildAttachment('2')], {
      initialSelection: 1,
      onEdit
    })

    const buttons = screen.getAllByRole('button')
    const details = buttons.findIndex((b) => b.textContent === 'Details')
    expect(buttons[details + 1]).toHaveTextContent('Edit')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(1)
  })

  it('keeps the info overlay open when an edit hands it the same photos', () => {
    const { rerenderWith } = renderModal([buildAttachment('1')], {
      onEdit: vi.fn()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )

    rerenderWith([buildAttachment('1', { name: 'Edited alt' })])

    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  it('closes the info overlay when the photos are a different list', () => {
    const { rerenderWith } = renderModal([buildAttachment('1')], {
      onEdit: vi.fn()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    rerenderWith([buildAttachment('2')])

    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })
})
