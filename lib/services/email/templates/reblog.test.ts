import { ActorProfile } from '@/lib/models/actor'
import { EditableStatus, StatusType } from '@/lib/models/status'

import { getHTMLContent, getSubject, getTextContent } from './reblog'

describe('reblog email template', () => {
  const mockActor: ActorProfile = {
    id: 'https://remote.example.com/users/reblogger',
    username: 'reblogger',
    domain: 'remote.example.com',
    name: 'Reblogger User',
    createdAt: Date.now(),
    statusesCount: 0,
    followersCount: 0,
    followingCount: 0
  }

  const mockStatus: EditableStatus = {
    id: 'https://test.llun.dev/statuses/123',
    url: 'https://test.llun.dev/@user/123',
    actorId: 'https://test.llun.dev/users/user',
    actor: {
      id: 'https://test.llun.dev/users/user',
      username: 'user',
      domain: 'test.llun.dev',
      name: 'Test User',
      createdAt: Date.now(),
      statusesCount: 0,
      followersCount: 0,
      followingCount: 0
    },
    type: StatusType.enum.Note,
    text: 'This is my awesome post!',
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
      expect(result).toMatch(/@reblogger reblogged your post in/)
    })
  })

  describe('#getTextContent', () => {
    it('returns text content with local URL and message', () => {
      const result = getTextContent(mockActor, mockStatus)
      // Should include the actor who reblogged
      expect(result).toContain(
        '@reblogger@remote.example.com reblogged your post'
      )
      expect(result).toContain('Your post: This is my awesome post!')
      // Should use local server URL (test.llun.dev from mock config)
      expect(result).toContain('View this post on your server:')
      expect(result).toContain('test.llun.dev/@user')
    })
  })

  describe('#getHTMLContent', () => {
    it('returns HTML content with message and local URL', () => {
      const result = getHTMLContent(mockActor, mockStatus)
      expect(result).toContain(
        '@reblogger@remote.example.com reblogged your post'
      )
      expect(result).toContain('<p>This is my awesome post!</p>')
      // Should link to local server, not remote
      expect(result).toContain('View this post on your server')
      expect(result).toContain('test.llun.dev/@user')
    })
  })
})
