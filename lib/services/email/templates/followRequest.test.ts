import { Actor } from '@/lib/types/domain/actor'

import { getHTMLContent, getSubject, getTextContent } from './followRequest'

describe('followRequest email template', () => {
  const mockActor: Actor = {
    id: 'https://remote.example.com/users/requester',
    username: 'requester',
    domain: 'remote.example.com',
    name: 'Requester User',
    createdAt: Date.now(),
    statusesCount: 0,
    followersCount: 0,
    followingCount: 0
  }

  describe('#getSubject', () => {
    it('returns subject with actor username and host', () => {
      const result = getSubject(mockActor)
      expect(result).toMatch(/@requester wants to follow you in/)
    })
  })

  describe('#getTextContent', () => {
    it('returns text content with username and id', () => {
      const result = getTextContent(mockActor)
      expect(result).toEqual(
        'requester (https://remote.example.com/users/requester) has requested to follow you'
      )
    })
  })

  describe('#getHTMLContent', () => {
    it('returns HTML content with linked actor', () => {
      const result = getHTMLContent(mockActor)
      expect(result).toEqual(
        '<p><a href="https://remote.example.com/users/requester">requester</a> has requested to follow you</p>'
      )
    })
  })
})
