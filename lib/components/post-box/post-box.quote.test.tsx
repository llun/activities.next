/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'

import { PostBox } from './post-box'
import {
  createNoteMock,
  openPostOptions,
  profile,
  resetEditMediaMocks
} from './post-box.testUtils'

vi.mock('@/lib/client', () => ({
  createNote: vi.fn(),
  createPoll: vi.fn(),
  deleteAccountMedia: vi.fn().mockResolvedValue(true),
  deleteFitnessFile: vi.fn(),
  getCustomEmojis: vi.fn().mockResolvedValue([]),
  getDefaultQuotePolicy: vi.fn().mockResolvedValue('public'),
  getGallerySettings: vi.fn().mockResolvedValue({
    allowEmptyDescription: true,
    altTextAvailable: false
  }),
  getMedia: vi.fn().mockRejectedValue(new Error('details unavailable')),
  updateNote: vi.fn(),
  uploadAttachment: vi.fn(),
  uploadFitnessFile: vi.fn()
}))

vi.mock('@/lib/utils/resizeImage', () => ({
  resizeImage: vi.fn((file) => Promise.resolve(file))
}))

describe('PostBox quote composing', () => {
  beforeEach(() => {
    resetEditMediaMocks()
  })

  it('shows the quoted preview and sends quotedStatus when composing a quote', async () => {
    const quotedStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={quotedStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(screen.getByText('Quoting')).toBeInTheDocument()

    const textbox = screen.getByPlaceholderText('What is on your mind?')
    expect(textbox).toHaveValue('')
    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeDisabled()

    fireEvent.change(textbox, {
      target: {
        value: 'my commentary'
      }
    })
    await waitFor(() => expect(postButton).toBeEnabled())
    fireEvent.click(postButton)

    await waitFor(() => {
      expect(createNoteMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'my commentary',
          quotedStatus
        })
      )
    })
  })

  it('preserves commentary when quote preview is dismissed', async () => {
    const onDiscardQuote = vi.fn()
    const quotedStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={quotedStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={onDiscardQuote}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textbox = screen.getByPlaceholderText('What is on your mind?')
    fireEvent.change(textbox, {
      target: {
        value: 'my commentary'
      }
    })

    const dismissButton = screen.getByRole('button', { name: 'Dismiss quote' })
    fireEvent.click(dismissButton)

    expect(onDiscardQuote).toHaveBeenCalled()
    expect(textbox).toHaveValue('my commentary')
  })

  it('keeps post button disabled when quote preview is dismissed without commentary', async () => {
    const onDiscardQuote = vi.fn()
    const quotedStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      url: 'https://activities.local/@bob/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={quotedStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={onDiscardQuote}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    const textbox = screen.getByPlaceholderText('What is on your mind?')
    expect(textbox).toHaveValue('')

    const dismissButton = screen.getByRole('button', { name: 'Dismiss quote' })
    fireEvent.click(dismissButton)

    expect(onDiscardQuote).toHaveBeenCalled()
    expect(textbox).toHaveValue('')
    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeDisabled()
  })

  it('combines quote preview and reply mentions when both quoting and replying', async () => {
    const quotedStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      url: 'https://activities.local/@bob/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    const replyStatus = {
      id: 'https://activities.local/users/alice/statuses/2',
      url: 'https://activities.local/@alice/2',
      actorId: 'https://activities.local/users/alice',
      actor: {
        id: 'https://activities.local/users/alice',
        username: 'alice',
        domain: 'activities.local',
        name: 'Alice'
      },
      type: StatusType.enum.Note,
      text: 'reply to me',
      tags: [],
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: []
    } as unknown as StatusNote

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={quotedStatus}
        replyStatus={replyStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(screen.getByText('Quoting')).toBeInTheDocument()
    const textbox = screen.getByPlaceholderText('What is on your mind?')
    expect(textbox).toHaveValue('@alice@activities.local ')
  })

  it('unwraps announced status when quoting a boost', async () => {
    const originalStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      url: 'https://activities.local/@bob/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    const announceStatus = {
      id: 'https://activities.local/users/alice/statuses/2',
      actorId: 'https://activities.local/users/alice',
      type: StatusType.enum.Announce,
      originalStatus,
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={announceStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    expect(screen.getByText('Quoting')).toBeInTheDocument()
    expect(screen.getByText('quote me please')).toBeInTheDocument()
    const textbox = screen.getByPlaceholderText('What is on your mind?')
    expect(textbox).toHaveValue('')
  })

  it('disables the poll toggle while composing a quote (mutually exclusive)', async () => {
    const quotedStatus = {
      id: 'https://activities.local/users/bob/statuses/1',
      actorId: 'https://activities.local/users/bob',
      actor: {
        id: 'https://activities.local/users/bob',
        username: 'bob',
        domain: 'activities.local',
        name: 'Bob'
      },
      type: StatusType.enum.Note,
      text: 'quote me please',
      tags: [],
      to: [],
      cc: []
    } as unknown as Status

    render(
      <PostBox
        host="activities.local"
        profile={profile}
        quotedStatus={quotedStatus}
        onDiscardReply={vi.fn()}
        onDiscardQuote={vi.fn()}
        onPostCreated={vi.fn()}
        onPostUpdated={vi.fn()}
        onDiscardEdit={vi.fn()}
      />
    )

    await openPostOptions()

    const poll = screen.getByRole('menuitemcheckbox', { name: /^Poll/ })
    expect(poll).toHaveAttribute('aria-disabled', 'true')
    expect(poll).toHaveTextContent('A quote post cannot include a poll')
  })
})
