import { ReactElement, ReactNode } from 'react'

import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  GalleryAlbumMatrix,
  seedGalleryAlbumMatrix
} from '@/lib/services/gallery/galleryAlbumMatrixFixtures'
import { PUBLIC_GALLERY_AUDIENCE } from '@/lib/services/gallery/galleryAudience'
import { EXTERNAL_ACTOR1 } from '@/lib/stub/seed/external1'
import { Actor } from '@/lib/types/domain/actor'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

import { PublicGalleryAlbumView } from './PublicGalleryAlbumView'
import Page, { generateMetadata } from './page'

let mockDatabase:
  ReturnType<typeof getTestDatabaseWithInstance>['database'] | null = null
vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test', mediaStorage: null })
}))

const mockSession = vi.fn()
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: () => mockSession()
}))

let mockCurrentActor: Actor | null = null
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: async () => mockCurrentActor
}))

// Mirrors the real notFound(), which throws to unwind the render.
class NotFoundError extends Error {}
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new NotFoundError('NEXT_HTTP_ERROR_FALLBACK;404')
  }
}))

vi.mock('@/lib/components/layout/mobile-compact-header', () => ({
  MobileCompactHeader: () => null
}))

vi.mock('./PublicGalleryAlbumView', () => ({
  PublicGalleryAlbumView: () => null
}))

type ViewProps = Parameters<typeof PublicGalleryAlbumView>[0]

// The page is a server component: call it, then find the client view in the
// tree it returns and read the props the server gave it.
const findView = (node: ReactNode): ReactElement<ViewProps> | null => {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findView(child)
      if (found) return found
    }
    return null
  }
  const element = node as ReactElement<{ children?: ReactNode }>
  if (element.type === PublicGalleryAlbumView) {
    return element as unknown as ReactElement<ViewProps>
  }
  return findView(element.props?.children)
}

describe('public album page', () => {
  const { database, prepare } = getTestDatabaseWithInstance()
  let matrix: GalleryAlbumMatrix
  let handle: string

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    matrix = await seedGalleryAlbumMatrix(database)
    mockDatabase = database
    const owner = (await database.getActorFromId({ id: matrix.ownerId }))!
    handle = encodeURIComponent(`@${owner.username}@${owner.domain}`)
  })

  afterAll(async () => {
    mockDatabase = null
    await database.destroy()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockSession.mockResolvedValue(null)
    mockCurrentActor = null
  })

  const params = (id: string, actor = handle) => ({
    params: Promise.resolve({ actor, id })
  })

  const viewers: Array<[string, () => Actor | null]> = [
    ['a logged-out visitor', () => null],
    ['a stranger', () => matrix.viewers.stranger],
    ['a blocked account', () => matrix.viewers.blocked],
    ['a follower', () => matrix.viewers.follower]
  ]

  describe('the page', () => {
    const itemIds = async (id: string) => {
      const element = await Page(params(id))
      return findView(element)!
        .props.initial.items.map((item) => item.mediaId)
        .sort()
    }
    const named = (...names: string[]) =>
      names.map((name) => matrix.media[name]).sort()

    it.each([
      ['a logged-out visitor', null, ['public', 'unlisted']],
      ['a stranger', 'stranger', ['public', 'unlisted']],
      ['a blocked account', 'blocked', ['public', 'unlisted']],
      ['a follower', 'follower', ['public', 'unlisted', 'followers']]
    ] as const)(
      'renders only the posts %s may read',
      async (_, who, visible) => {
        mockCurrentActor = who ? matrix.viewers[who] : null

        expect(await itemIds(matrix.albums.mixed)).toEqual(named(...visible))
      }
    )

    it('passes the view its owner, address and page size', async () => {
      const view = findView(await Page(params(matrix.albums.mixed)))!

      expect(view.props).toMatchObject({
        ownerId: matrix.ownerId,
        profileHref: '/@test6@llun.test',
        pageUrl: `https://llun.test/@test6@llun.test/albums/${matrix.albums.mixed}`,
        pageSize: 30
      })
      expect(view.props.initial.album.title).toBe('Mixed')
    })

    it('shows the owner their own photos and nothing the owner cannot see either', async () => {
      mockCurrentActor = (await database.getActorFromId({
        id: matrix.ownerId
      }))!

      expect(await itemIds(matrix.albums.mixed)).toEqual(
        named('public', 'unlisted', 'followers', 'direct')
      )
    })

    describe('the owner opening their own album', () => {
      const ownerNotice = async (id: string, who: Actor | null) => {
        mockCurrentActor = who
        return findView(await Page(params(id)))!.props.ownerNotice
      }
      const owner = () => database.getActorFromId({ id: matrix.ownerId })

      it('is told nothing for an album visitors can open', async () => {
        expect(
          await ownerNotice(matrix.albums.mixed, (await owner())!)
        ).toBeUndefined()
      })

      it('is told a private album is closed to visitors, with the link to the owner page', async () => {
        expect(
          await ownerNotice(matrix.albums.secret, (await owner())!)
        ).toEqual({
          reason: 'private',
          manageHref: `/gallery/albums/${matrix.albums.secret}`
        })
      })

      it('is told an empty album is closed to visitors', async () => {
        expect(
          await ownerNotice(matrix.albums.empty, (await owner())!)
        ).toEqual({
          reason: 'nothing-public',
          manageHref: `/gallery/albums/${matrix.albums.empty}`
        })
      })

      it('is told when every photo is hidden from visitors', async () => {
        expect(
          await ownerNotice(matrix.albums.followersOnly, (await owner())!)
        ).toMatchObject({ reason: 'nothing-public' })
      })

      it('is the only one told: a follower of an album they can open gets none', async () => {
        expect(
          await ownerNotice(
            matrix.albums.followersOnly,
            matrix.viewers.follower
          )
        ).toBeUndefined()
        expect(await ownerNotice(matrix.albums.mixed, null)).toBeUndefined()
      })
    })

    it.each([
      ['a private album', () => matrix.albums.secret],
      ['an empty album', () => matrix.albums.empty],
      ['an album of followers-only photos', () => matrix.albums.followersOnly],
      ['an album of direct photos', () => matrix.albums.directOnly],
      ['an album of deleted photos', () => matrix.albums.goneOnly],
      ['an id that does not exist', () => 'no-such-album']
    ])('is the same not-found for %s', async (_, id) => {
      await expect(Page(params(id()))).rejects.toBeInstanceOf(NotFoundError)
    })

    it.each([
      ['an account that does not exist', '@nobody@llun.test'],
      [
        'a handle on another server that nobody seeded',
        '@someone@remote.example'
      ],
      ['a handle without a domain', '@test6'],
      ['a path without an @', 'test6@llun.test'],
      ['a handle with a third part', '@test6@llun.test@x']
    ])('is not-found for %s', async (_, raw) => {
      await expect(
        Page(params(matrix.albums.mixed, encodeURIComponent(raw)))
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('is not-found for a remote actor, even one that holds a public album with a public photo', async () => {
      // A remote actor row exists (`@test1@llun.dev`) but has no local account.
      // Give it everything a local owner's visible album has, so the only thing
      // standing between the handle and a rendered page is the account check.
      const remote = (await database.getActorFromId({ id: EXTERNAL_ACTOR1 }))!
      expect(remote.account).toBeFalsy()
      const media = await database.createMedia({
        actorId: EXTERNAL_ACTOR1,
        original: {
          path: '/test/remote-album.jpg',
          bytes: 1000,
          mimeType: 'image/jpeg',
          metaData: { width: 400, height: 300 }
        },
        details: { inGallery: true, takenAt: Date.UTC(2026, 0, 1) }
      })
      const statusId = `${EXTERNAL_ACTOR1}/statuses/remote-album`
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: EXTERNAL_ACTOR1,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'remote'
      })
      await database.createAttachment({
        actorId: EXTERNAL_ACTOR1,
        statusId,
        mediaType: 'image/jpeg',
        url: 'https://media.test/remote-album.jpg',
        width: 400,
        height: 300,
        mediaId: media!.id
      })
      const created = await database.createGalleryAlbumWithinLimit({
        actorId: EXTERNAL_ACTOR1,
        title: 'Remote',
        visibility: 'public',
        limit: 50,
        mediaIds: [media!.id],
        itemLimit: 2000
      })
      if (created.status !== 'created') throw new Error('album not created')

      // Visible to the audience, so only the account check can refuse it.
      expect(
        await database.getGalleryAlbum({
          id: created.album.id,
          actorId: EXTERNAL_ACTOR1,
          audience: PUBLIC_GALLERY_AUDIENCE
        })
      ).not.toBeNull()
      const remoteHandle = encodeURIComponent(
        `@${remote.username}@${remote.domain}`
      )
      await expect(
        Page(params(created.album.id, remoteHandle))
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(
        await generateMetadata(params(created.album.id, remoteHandle))
      ).toMatchObject({ title: 'Album' })
    })

    it('is not-found for a malformed handle escape', async () => {
      await expect(
        Page(params(matrix.albums.mixed, '%E0%A4%A'))
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it("does not open one account's album under another handle", async () => {
      await expect(
        Page(
          params(matrix.albums.mixed, encodeURIComponent('@test1@llun.test'))
        )
      ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('carries no owner-only field to a visitor', async () => {
      mockCurrentActor = matrix.viewers.follower
      const view = findView(await Page(params(matrix.albums.places)))!
      const text = JSON.stringify(view.props)

      expect(view.props.initial.album.hiddenPlaceCount).toBe(0)
      expect(text).not.toMatch(/subjectIucnCategory|subjectLookupStatus/)
      for (const withheld of ['Hemis', 'Burrow', 'Home', 'Nest site']) {
        expect(text).not.toContain(withheld)
      }
    })
  })

  describe('the link preview', () => {
    const metadata = (id: string) => generateMetadata(params(id))

    it('is the logged-out album, whoever is looking', async () => {
      const results: unknown[] = []
      for (const [, who] of viewers) {
        mockCurrentActor = who()
        results.push(await metadata(matrix.albums.mixed))
      }
      mockCurrentActor = (await database.getActorFromId({
        id: matrix.ownerId
      }))!
      results.push(await metadata(matrix.albums.mixed))

      for (const result of results) {
        expect(result).toEqual(results[0])
      }
    })

    it('counts, dates and covers only what a logged-out visitor can open', async () => {
      // The owner picked the followers-only heron as the cover.
      mockCurrentActor = matrix.viewers.follower
      const result = await metadata(matrix.albums.mixed)

      expect(result.title).toBe('Mixed · @test6@llun.test')
      expect(result.description).toBe(
        '2 photos · 10 Jan – 10 Feb 2026 · United Kingdom · by @test6@llun.test — One photo for every kind of post.'
      )
      const [image] = result.openGraph!.images as Array<{ url: string }>
      expect([
        'https://media.test/matrix-public.jpg',
        'https://media.test/matrix-unlisted.jpg'
      ]).toContain(image.url)
      expect(result.alternates?.canonical).toBe(
        `https://llun.test/@test6@llun.test/albums/${matrix.albums.mixed}`
      )
    })

    it('carries nothing about a photo, place or date the public view hides', async () => {
      mockCurrentActor = matrix.viewers.follower
      const text = JSON.stringify([
        await metadata(matrix.albums.mixed),
        await metadata(matrix.albums.places)
      ])

      for (const hidden of [
        'matrix-followers.jpg',
        'matrix-direct.jpg',
        'matrix-deleted.jpg',
        'matrix-hidden.jpg',
        'Marsh',
        'Hemis',
        'Burrow',
        'Nest site',
        'Home',
        'Netherlands',
        'India'
      ]) {
        expect(text).not.toContain(hidden)
      }
      // The date range ends on the last public photo, not the followers' one.
      expect(text).not.toContain('10 Mar')
    })

    it('names no country when the visible places span several', async () => {
      const result = await metadata(matrix.albums.places)

      expect(result.description).toContain('7 photos')
      // Two countries are shown (South Africa, Thailand), so none is named; and
      // the threatened species' India is not among them.
      expect(result.description).not.toContain('India')
      expect(result.description).not.toContain('South Africa')
    })

    it.each([
      ['a private album', () => matrix.albums.secret],
      ['an empty album', () => matrix.albums.empty],
      ['an album of followers-only photos', () => matrix.albums.followersOnly],
      ['an id that does not exist', () => 'no-such-album']
    ])('gives %s the same bare tags as a missing one', async (_, id) => {
      mockCurrentActor = matrix.viewers.follower

      const result = await metadata(id())

      expect(result).toEqual({
        title: 'Album',
        robots: { index: false, follow: false }
      })
    })

    it('gives a missing account the bare tags', async () => {
      expect(
        await generateMetadata(
          params(matrix.albums.mixed, encodeURIComponent('@nobody@llun.test'))
        )
      ).toEqual({
        title: 'Album',
        robots: { index: false, follow: false }
      })
    })
  })
})
