import { ActorProfile } from '@/lib/types/domain/actor'
import { EditableStatus, StatusType } from '@/lib/types/domain/status'

import { getHTMLContent, getSubject, getTextContent } from './reply'

describe('reply email template', () => {
  const mockActor: ActorProfile = {
    id: 'https://remote.example.com/users/replier',
    username: 'replier',
    domain: 'remote.example.com',
    name: 'Replier User',
    createdAt: Date.now(),
    statusesCount: 0,
    followersCount: 0,
    followingCount: 0
  }

  const mockStatus: EditableStatus = {
    id: 'https://remote.example.com/statuses/456',
    url: 'https://remote.example.com/@replier/456',
    actorId: 'https://remote.example.com/users/replier',
    actor: {
      id: 'https://remote.example.com/users/replier',
      username: 'replier',
      domain: 'remote.example.com',
      name: 'Replier User',
      createdAt: Date.now(),
      statusesCount: 0,
      followersCount: 0,
      followingCount: 0
    },
    type: StatusType.enum.Note,
    text: 'This is a reply to your post!',
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
      expect(result).toMatch(/@replier replied to your post in/)
    })
  })

  describe('#getTextContent', () => {
    it('returns text content with message and local URL', () => {
      const result = getTextContent(mockStatus)
      expect(result).toContain(
        '@replier@remote.example.com replied to your post'
      )
      expect(result).toContain('Reply: This is a reply to your post!')
      expect(result).toContain('View this post on your server:')
    })
  })

  describe('#getHTMLContent', () => {
    it('returns HTML content with message and local URL', () => {
      const result = getHTMLContent(mockStatus)
      expect(result).toContain(
        '@replier@remote.example.com replied to your post'
      )
      expect(result).toContain('View this post on your server')
    })
  })
})
