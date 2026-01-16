import { Actor } from '@/lib/models/actor'

import { getHTMLContent, getSubject, getTextContent } from './actorDeleted'

jest.mock('../../../config', () => ({
  getConfig: jest.fn().mockReturnValue({
    host: 'test.social'
  })
}))

describe('actorDeleted email template', () => {
  const mockActor: Actor = {
    id: 'https://test.social/users/testuser',
    username: 'testuser',
    domain: 'test.social',
    followersUrl: 'https://test.social/users/testuser/followers',
    inboxUrl: 'https://test.social/users/testuser/inbox',
    sharedInboxUrl: 'https://test.social/inbox',
    publicKey: 'publicKey',
    followingCount: 10,
    followersCount: 20,
    statusCount: 5,
    lastStatusAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  describe('getSubject', () => {
    it('returns correct subject line', () => {
      const subject = getSubject(mockActor)
      expect(subject).toBe(
        'Your actor @testuser@test.social has been deleted from test.social'
      )
    })
  })

  describe('getTextContent', () => {
    it('returns correct text content', () => {
      const text = getTextContent(mockActor)
      expect(text).toContain('@testuser@test.social')
      expect(text).toContain('successfully deleted')
      expect(text).toContain('test.social')
    })
  })

  describe('getHTMLContent', () => {
    it('returns correct HTML content', () => {
      const html = getHTMLContent(mockActor)
      expect(html).toContain('<strong>@testuser@test.social</strong>')
      expect(html).toContain('successfully deleted')
      expect(html).toContain('test.social')
    })
  })
})
