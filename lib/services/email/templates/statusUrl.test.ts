import { Status, StatusType } from '@/lib/types/domain/status'

import { getEmailActorUrl, getEmailStatusUrl } from './statusUrl'

const HOST = 'test.llun.dev'
const BASE_URL = `https://${HOST}`

const remoteStatus = {
  id: 'https://remote.example.com/statuses/9',
  url: 'https://remote.example.com/@rin/9',
  actorId: 'https://remote.example.com/users/rin',
  actor: {
    id: 'https://remote.example.com/users/rin',
    username: 'rin',
    domain: 'remote.example.com',
    followersUrl: '',
    inboxUrl: '',
    sharedInboxUrl: '',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: 1000
  },
  isLocalActor: false,
  type: StatusType.enum.Note,
  text: 'hi',
  summary: '',
  to: [],
  cc: [],
  tags: [],
  attachments: [],
  replies: [],
  createdAt: 1000
} as unknown as Status

describe('getEmailStatusUrl', () => {
  it('points a remote status at the recipient own server, not the origin', () => {
    const url = getEmailStatusUrl(remoteStatus)
    expect(url.startsWith(`${BASE_URL}/`)).toBe(true)
    expect(url).toContain('@rin@remote.example.com')
    expect(url).not.toContain('remote.example.com/@rin/9')
  })

  it('uses the configured scheme rather than assuming https', () => {
    // getBaseURL() honours ACTIVITIES_INSECURE_AUTH; the four copies this
    // replaces hardcoded https://${config.host}.
    expect(getEmailStatusUrl(remoteStatus).startsWith(BASE_URL)).toBe(true)
  })

  it('falls back to the status url when no path can be derived', () => {
    const actorless = { ...remoteStatus, actor: undefined } as unknown as Status
    expect(getEmailStatusUrl(actorless)).toBe(remoteStatus.url)
  })
})

describe('getEmailActorUrl', () => {
  it('builds a local profile url from a handle', () => {
    expect(getEmailActorUrl('@rin@remote.example.com')).toBe(
      `${BASE_URL}/@rin@remote.example.com`
    )
  })
})
