import { generateMetadata } from './page'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
  getBaseURL: vi.fn().mockReturnValue('https://llun.test')
}))

vi.mock('@/lib/database', () => ({
  getDatabase: vi.fn()
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn()
}))

vi.mock('@/lib/services/queue', () => ({
  getQueue: vi.fn()
}))

vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn()
}))

vi.mock('./Header', () => ({
  Header: () => null
}))

vi.mock('./RemoteStatusLoading', () => ({
  RemoteStatusLoading: () => null
}))

vi.mock('./StatusBox', () => ({
  StatusBox: () => null
}))

vi.mock('./resolveStatusFromPath', () => ({
  decodePathParam: (segment: string) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  },
  resolveStatusFromPath: vi.fn()
}))

describe('generateMetadata', () => {
  it('emits the canonical URL, description and oEmbed discovery link for the status page', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@llun.test',
        status: 'status-1'
      })
    })

    expect(metadata.title).toBe('@test1@llun.test status')
    expect(metadata.description).toBe(
      "View @test1@llun.test's post on Activities.next"
    )
    const pageUrl = 'https://llun.test/%40test1%40llun.test/status-1'
    expect(metadata.alternates?.canonical).toBe(pageUrl)
    expect(metadata.alternates?.types).toEqual({
      'application/json+oembed': `https://llun.test/api/oembed?url=${encodeURIComponent(pageUrl)}`
    })
  })

  it('derives description from status text with decoded HTML entities and canonical local path', async () => {
    const { getDatabase } = await import('@/lib/database')
    const { resolveStatusFromPath } = await import('./resolveStatusFromPath')
    vi.mocked(getDatabase).mockReturnValueOnce({} as never)
    vi.mocked(resolveStatusFromPath).mockResolvedValueOnce({
      status: {
        id: 'https://llun.test/users/test1/statuses/status-1',
        publicId: '01955555-5555-7555-8555-555555555555',
        url: 'https://llun.test/@test1/status-1',
        actor: {
          username: 'test1',
          domain: 'llun.test'
        },
        isLocalActor: true,
        type: 'Note',
        text: '<p>Hello &amp; welcome</p><p>It&#39;s &quot;Activities.next&quot;!</p>',
        summary: '',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      }
    } as never)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@llun.test',
        status: 'status-1'
      })
    })

    expect(metadata.description).toBe(
      'Hello & welcome It\'s "Activities.next"!'
    )
    expect(metadata.robots).toBeUndefined()
    expect(metadata.alternates?.canonical).toBe(
      'https://llun.test/@test1@llun.test/01955555-5555-7555-8555-555555555555'
    )
    const pageUrl = 'https://llun.test/%40test1%40llun.test/status-1'
    expect(metadata.alternates?.types).toEqual({
      'application/json+oembed': `https://llun.test/api/oembed?url=${encodeURIComponent(pageUrl)}`
    })
  })

  it('does not set noindex for a local public post on a secondary allowed actor domain or port', async () => {
    const { getBaseURL, getConfig } = await import('@/lib/config')
    const { getDatabase } = await import('@/lib/database')
    const { resolveStatusFromPath } = await import('./resolveStatusFromPath')
    vi.mocked(getBaseURL).mockReturnValueOnce('http://localhost:3000')
    vi.mocked(getConfig).mockReturnValueOnce({
      host: 'localhost:3000',
      allowActorDomains: ['second.example']
    } as never)
    vi.mocked(getDatabase).mockReturnValueOnce({} as never)
    vi.mocked(resolveStatusFromPath).mockResolvedValueOnce({
      status: {
        id: 'http://localhost:3000/users/test1/statuses/status-2',
        publicId: '01955555-5555-7555-8555-555555555556',
        url: 'http://localhost:3000/@test1@second.example/status-2',
        actor: {
          username: 'test1',
          domain: 'second.example'
        },
        isLocalActor: true,
        type: 'Note',
        text: '<p>Secondary domain post</p>',
        summary: '',
        to: ['as:Public'],
        cc: []
      }
    } as never)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@second.example',
        status: 'status-2'
      })
    })

    expect(metadata.robots).toBeUndefined()
    expect(metadata.description).toBe('Secondary domain post')
    expect(metadata.alternates?.canonical).toBe(
      'https://llun.test/@test1@second.example/01955555-5555-7555-8555-555555555556'
    )

    vi.mocked(getBaseURL).mockReturnValueOnce('http://localhost:3000')
    vi.mocked(getConfig).mockReturnValueOnce({
      host: 'localhost:3000',
      allowActorDomains: ['second.example']
    } as never)
    vi.mocked(getDatabase).mockReturnValueOnce(null)

    const fallbackMetadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@second.example',
        status: 'status-2'
      })
    })

    expect(fallbackMetadata.robots).toBeUndefined()
    expect(fallbackMetadata.alternates?.canonical).toBe(
      'http://localhost:3000/%40test1%40second.example/status-2'
    )
  })

  it('points canonical URL to the remote origin and sets noindex for remote statuses', async () => {
    const { getDatabase } = await import('@/lib/database')
    const { resolveStatusFromPath } = await import('./resolveStatusFromPath')
    vi.mocked(getDatabase).mockReturnValueOnce({} as never)
    vi.mocked(resolveStatusFromPath).mockResolvedValueOnce({
      status: {
        id: 'https://remote.example/users/alice/statuses/99',
        url: 'https://remote.example/@alice/99',
        actor: {
          username: 'alice',
          domain: 'remote.example'
        },
        isLocalActor: false,
        type: 'Note',
        text: '<p>Remote note</p>',
        summary: '',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: []
      }
    } as never)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@alice@remote.example',
        status: '99'
      })
    })

    expect(metadata.alternates?.canonical).toBe(
      'https://remote.example/@alice/99'
    )
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })

  it('omits self canonical and sets noindex when a remote status is not stored locally', async () => {
    const { getDatabase } = await import('@/lib/database')
    const { resolveStatusFromPath } = await import('./resolveStatusFromPath')
    vi.mocked(getDatabase).mockReturnValueOnce({} as never)
    vi.mocked(resolveStatusFromPath).mockResolvedValueOnce({
      pathActor: {
        username: 'alice',
        domain: 'remote.example'
      },
      status: null,
      statusId: '',
      fullStatusId: 'https://remote.example/users/alice/statuses/99',
      isStatusHash: false
    } as never)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@alice@remote.example',
        status: '99'
      })
    })

    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBeUndefined()
  })

  it('does not leak unlisted status text and sets noindex in metadata', async () => {
    const { getDatabase } = await import('@/lib/database')
    const { resolveStatusFromPath } = await import('./resolveStatusFromPath')
    vi.mocked(getDatabase).mockReturnValueOnce({} as never)
    vi.mocked(resolveStatusFromPath).mockResolvedValueOnce({
      status: {
        id: 'status-unlisted',
        type: 'Note',
        text: '<p>Unlisted quiet post content</p>',
        summary: '',
        actor: {
          followersUrl: 'https://llun.test/users/test1/followers'
        },
        to: ['https://llun.test/users/test1/followers'],
        cc: ['https://www.w3.org/ns/activitystreams#Public']
      }
    } as never)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@llun.test',
        status: 'status-unlisted'
      })
    })

    expect(metadata.description).toBe(
      "View @test1@llun.test's post on Activities.next"
    )
    expect(metadata.description).not.toContain('Unlisted quiet post content')
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBeUndefined()
  })

  it('does not leak followers-only status text in metadata description', async () => {
    const { getDatabase } = await import('@/lib/database')
    const { resolveStatusFromPath } = await import('./resolveStatusFromPath')
    vi.mocked(getDatabase).mockReturnValueOnce({} as never)
    vi.mocked(resolveStatusFromPath).mockResolvedValueOnce({
      status: {
        id: 'status-followers',
        type: 'Note',
        text: '<p>Followers-only content</p>',
        summary: '',
        actor: {
          followersUrl: 'https://llun.test/users/test1/followers'
        },
        to: ['https://llun.test/users/test1/followers'],
        cc: []
      }
    } as never)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@llun.test',
        status: 'status-followers'
      })
    })

    expect(metadata.description).toBe(
      "View @test1@llun.test's post on Activities.next"
    )
    expect(metadata.description).not.toContain('Followers-only content')
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBeUndefined()
  })

  it('does not leak direct status text in metadata description', async () => {
    const { getDatabase } = await import('@/lib/database')
    const { resolveStatusFromPath } = await import('./resolveStatusFromPath')
    vi.mocked(getDatabase).mockReturnValueOnce({} as never)
    vi.mocked(resolveStatusFromPath).mockResolvedValueOnce({
      status: {
        id: 'status-2',
        type: 'Note',
        text: '<p>Secret direct message content</p>',
        summary: '',
        to: ['https://llun.test/users/test2'],
        cc: []
      }
    } as never)

    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '@test1@llun.test',
        status: 'status-2'
      })
    })

    expect(metadata.description).toBe(
      "View @test1@llun.test's post on Activities.next"
    )
    expect(metadata.description).not.toContain('Secret direct message content')
    expect(metadata.robots).toEqual({ index: false, follow: false })
    expect(metadata.alternates?.canonical).toBeUndefined()
  })

  it('does not throw when the actor route has malformed URI escapes', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({
        actor: '%E0%A4%A',
        status: 'status-id'
      })
    })

    expect(metadata.title).toBe('%E0%A4%A status')
    expect(metadata.description).toBe("View %E0%A4%A's post on Activities.next")
    // Malformed escapes fall back to the raw segment, re-encoded.
    const pageUrl = 'https://llun.test/%25E0%25A4%25A/status-id'
    expect(metadata.alternates?.canonical).toBe(pageUrl)
    expect(metadata.alternates?.types).toEqual({
      'application/json+oembed': `https://llun.test/api/oembed?url=${encodeURIComponent(pageUrl)}`
    })
  })
})
