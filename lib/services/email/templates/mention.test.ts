import { ActorProfile } from '@/lib/models/actor'
import { EditableStatus, StatusType } from '@/lib/models/status'

import { getHTMLContent, getSubject, getTextContent } from './mention'

describe('mention email template', () => {
  const mockActor: ActorProfile = {
    id: 'https://remote.example.com/users/mentioner',
    username: 'mentioner',
    domain: 'remote.example.com',
    name: 'Mentioner User',
    createdAt: Date.now(),
    statusCount: 0,
    followersCount: 0,
    followingCount: 0,
    followersUrl: 'https://remote.example.com/users/mentioner/followers',
    inboxUrl: 'https://remote.example.com/users/mentioner/inbox',
    sharedInboxUrl: 'https://remote.example.com/inbox',
    lastStatusAt: null
  }

  const mockStatus: EditableStatus = {
    id: 'https://remote.example.com/statuses/123',
    url: 'https://remote.example.com/@mentioner/123',
    actorId: mockActor.id,
    actor: null,
    type: StatusType.enum.Note,
    text: 'Hey @user@test.example.com check this out!',
    summary: '',
    to: [],
    cc: [],
    edits: [],
    isLocalActor: false,
    reply: '',
    actorAnnounceStatusId: null,
    isActorLiked: false,
    totalLikes: 0,
    tags: [],
    attachments: [],
    replies: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  describe('#getSubject', () => {
    it('returns subject with actor username and host', () => {
      const result = getSubject(mockActor)
      // Uses config host from test config
      expect(result).toMatch(/@mentioner mentions you in/)
    })
  })

  describe('#getTextContent', () => {
    it('returns text content with URL and message', () => {
      const result = getTextContent(mockStatus)
      expect(result).toContain('URL: https://remote.example.com/@mentioner/123')
      expect(result).toContain(
        'Message: Hey @user@test.example.com check this out!'
      )
    })
  })

  describe('#getHTMLContent', () => {
    it('returns HTML content with message and URL', () => {
      const result = getHTMLContent(mockStatus)
      expect(result).toContain(
        '<p>Hey @user@test.example.com check this out!</p>'
      )
      expect(result).toContain(
        '<p>At: https://remote.example.com/@mentioner/123</p>'
      )
    })
  })
})
