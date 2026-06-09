/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  getTranslationCapability,
  getTranslationLanguages,
  translateStatus,
  votePoll
} from '@/lib/client'
import { StatusPoll, StatusType } from '@/lib/types/domain/status'
import { Translation } from '@/lib/types/mastodon/translation'

import { Poll } from './poll'
import { TranslateContent } from './translate-content'
import { TranslationProvider } from './translation-context'

jest.mock('@/lib/client', () => ({
  translateStatus: jest.fn(),
  getTranslationCapability: jest.fn(),
  getTranslationLanguages: jest.fn(),
  votePoll: jest.fn()
}))

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const pollStatus: StatusPoll = {
  id: 'https://activities.local/statuses/poll-de',
  actorId: 'https://activities.local/actors/rin',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Poll,
  url: 'https://activities.local/@rin/poll-de',
  text: 'Wie zeichnest du deine Aktivitäten auf?',
  summary: null,
  language: 'de',
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments: [],
  tags: [],
  choices: [
    {
      statusId: 'https://activities.local/statuses/poll-de',
      title: 'Dedizierte GPS-Uhr',
      totalVotes: 10,
      createdAt: currentTime,
      updatedAt: currentTime
    },
    {
      statusId: 'https://activities.local/statuses/poll-de',
      title: 'Handy-App',
      totalVotes: 5,
      createdAt: currentTime,
      updatedAt: currentTime
    }
  ],
  endAt: currentTime - 30_000,
  pollType: 'oneOf'
}

const translation: Translation = {
  content: '<p>How do you record your activities?</p>',
  spoiler_text: '',
  language: 'en',
  media_attachments: [],
  poll: {
    id: pollStatus.id,
    options: [{ title: 'Dedicated GPS watch' }, { title: 'Phone app' }]
  },
  detected_source_language: 'de',
  provider: 'DeepL.com'
}

describe('status translation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(getTranslationCapability as jest.Mock).mockResolvedValue({
      enabled: true,
      defaultLanguage: 'en'
    })
    ;(getTranslationLanguages as jest.Mock).mockResolvedValue({
      de: ['en']
    })
    ;(translateStatus as jest.Mock).mockResolvedValue(translation)
  })

  it('flips the body and the poll option titles together on a single toggle', async () => {
    render(
      <TranslationProvider statusId={pollStatus.id} language="de">
        <TranslateContent statusId={pollStatus.id} language="de">
          <div>Wie zeichnest du deine Aktivitäten auf?</div>
        </TranslateContent>
        <Poll status={pollStatus} currentTime={currentTime} />
      </TranslationProvider>
    )

    // Original German option titles render first.
    expect(screen.getByText('Dedizierte GPS-Uhr')).toBeInTheDocument()

    fireEvent.click(
      await screen.findByRole('button', { name: /Translate from German/ })
    )

    // Body and poll options both flip to the translated copy.
    expect(
      await screen.findByText('How do you record your activities?')
    ).toBeInTheDocument()
    expect(screen.getByText('Dedicated GPS watch')).toBeInTheDocument()
    expect(screen.getByText('Phone app')).toBeInTheDocument()
    expect(screen.queryByText('Dedizierte GPS-Uhr')).not.toBeInTheDocument()

    // Showing the original reverts both the body and the poll together.
    fireEvent.click(screen.getByRole('button', { name: 'Show original' }))
    expect(screen.getByText('Dedizierte GPS-Uhr')).toBeInTheDocument()
    expect(screen.queryByText('Dedicated GPS watch')).not.toBeInTheDocument()

    // Only one backend call despite toggling back and forth.
    expect(votePoll).not.toHaveBeenCalled()
    expect(translateStatus).toHaveBeenCalledTimes(1)
  })
})
