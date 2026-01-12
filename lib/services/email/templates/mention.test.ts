import { ActorProfile } from '@/lib/models/actor'
import { EditableStatus, StatusType } from '@/lib/models/status'

import { getSubject, getTextContent, getHTMLContent } from './mention'

describe('mention email template', () => {
  const mockActor: ActorProfile = {
    id: 'https://remote.example.com/users/mentioner',
    username: 'mentioner',
    domain: 'remote.example.com',
    name: 'Mentioner User',
    createdAt: Date.now(),
    statusesCount: 0,
    followersCount: 0,
    followingCount: 0
  }

  const mockStatus: EditableStatus = {
    id: 'https://remote.example.com/statuses/123',
    url: 'https://remote.example.com/@mentioner/123',
    actorId: mockActor.id,
    type: StatusType.enum.Note,
    text: 'Hey @user@test.example.com check this out!',
    summary: '',
    to: [],
    cc: [],
    tags: [],
    attachments: [],
    replies: [],
    createdAt: Date.now()
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
