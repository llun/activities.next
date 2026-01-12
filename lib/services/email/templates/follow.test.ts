import { Actor } from '@/lib/models/actor'

import { getHTMLContent, getSubject, getTextContent } from './follow'

describe('follow email template', () => {
  const mockActor: Actor = {
    id: 'https://remote.example.com/users/follower',
    username: 'follower',
    domain: 'remote.example.com',
    name: 'Follower User',
    createdAt: Date.now(),
    statusesCount: 0,
    followersCount: 0,
    followingCount: 0
  }

  describe('#getSubject', () => {
    it('returns subject with actor username and host', () => {
      const result = getSubject(mockActor)
      // Uses config host from test config
      expect(result).toMatch(/@follower is following you in/)
    })
  })

  describe('#getTextContent', () => {
    it('returns text content with username and id', () => {
      const result = getTextContent(mockActor)
      expect(result).toEqual(
        'follower (https://remote.example.com/users/follower) is following you'
      )
    })
  })

  describe('#getHTMLContent', () => {
    it('returns HTML content with linked actor', () => {
      const result = getHTMLContent(mockActor)
      expect(result).toEqual(
        '<p><a href="https://remote.example.com/users/follower">follower</a> is following you</p>'
      )
    })
  })
})
