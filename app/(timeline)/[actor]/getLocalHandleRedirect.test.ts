import { MockActor } from '@/lib/stub/actor'
import type { Actor } from '@/lib/types/domain/actor'

import { getLocalHandleRedirect } from './getLocalHandleRedirect'

const localActor = (overrides: Partial<Actor> = {}) =>
  ({
    ...MockActor({}),
    id: 'https://old.example/users/alice',
    username: 'new.name',
    domain: 'new.example',
    privateKey: 'private-key',
    account: { id: 'account-id' },
    ...overrides
  }) as Actor

describe('getLocalHandleRedirect', () => {
  it.each([
    { pathname: '/@alice@old.example', expectedPath: '/@new.name@new.example' },
    {
      pathname: '/@alice@old.example/123',
      expectedPath: '/@new.name@new.example/123'
    },
    {
      pathname: '/@alice@old.example/followers',
      expectedPath: '/@new.name@new.example/followers'
    },
    {
      pathname: '/@alice@old.example/following',
      expectedPath: '/@new.name@new.example/following'
    },
    {
      pathname: '/@alice@old.example/albums/album-1',
      expectedPath: '/@new.name@new.example/albums/album-1'
    }
  ])(
    'redirects $pathname under the current handle',
    ({ pathname, expectedPath }) => {
      expect(
        getLocalHandleRedirect({
          actor: localActor(),
          requestedHandle: '@alice@old.example',
          pathname,
          search: '?tab=media&cursor=before%2Fafter'
        })
      ).toBe(`${expectedPath}?tab=media&cursor=before%2Fafter`)
    }
  )

  it('decodes the requested segment and preserves encoded nested segments', () => {
    expect(
      getLocalHandleRedirect({
        actor: localActor(),
        requestedHandle: '%40alice%40old.example',
        pathname: '/%40alice%40old.example/albums/photo%2F1',
        search: '?value=%25'
      })
    ).toBe('/@new.name@new.example/albums/photo%2F1?value=%25')
  })

  it.each([
    {
      description: 'a remote actor',
      actor: { privateKey: '', account: undefined }
    },
    {
      description: 'an actor without an account',
      actor: { privateKey: 'key', account: undefined }
    }
  ])('leaves $description unchanged', ({ actor }) => {
    expect(
      getLocalHandleRedirect({
        actor: localActor(actor),
        requestedHandle: '@alice@old.example',
        pathname: '/@alice@old.example/followers',
        search: '?page=2'
      })
    ).toBeNull()
  })

  it('leaves an unknown handle unchanged', () => {
    expect(
      getLocalHandleRedirect({
        actor: null,
        requestedHandle: '@missing@example.com',
        pathname: '/@missing@example.com',
        search: ''
      })
    ).toBeNull()
  })

  it('leaves the current handle unchanged', () => {
    expect(
      getLocalHandleRedirect({
        actor: localActor(),
        requestedHandle: '@new.name@new.example',
        pathname: '/@new.name@new.example',
        search: '?tab=posts'
      })
    ).toBeNull()
  })

  it('does not redirect when request path metadata is missing or malformed', () => {
    for (const pathname of [null, 'https://evil.example/path']) {
      expect(
        getLocalHandleRedirect({
          actor: localActor(),
          requestedHandle: '@alice@old.example',
          pathname,
          search: ''
        })
      ).toBeNull()
    }
  })

  // The proxy is the only writer of the captured-path headers, and it always
  // writes the request's own pathname. A first segment that is not the
  // requested handle means the value did not come from the rewrite this
  // helper exists for — honouring it would 308 an attacker-chosen
  // same-origin path.
  it('refuses a captured path whose first segment is not the requested handle', () => {
    expect(
      getLocalHandleRedirect({
        actor: localActor(),
        requestedHandle: '@alice@old.example',
        pathname: '/@bob@evil.example/followers',
        search: ''
      })
    ).toBeNull()
    expect(
      getLocalHandleRedirect({
        actor: localActor(),
        requestedHandle: '@alice@old.example',
        pathname: '/@alice@other.example/followers',
        search: ''
      })
    ).toBeNull()
  })

  it('refuses a captured path that climbs with ..', () => {
    expect(
      getLocalHandleRedirect({
        actor: localActor(),
        requestedHandle: '@alice@old.example',
        pathname: '/@alice@old.example/../../admin',
        search: ''
      })
    ).toBeNull()
  })

  // The proxy rewrites a bare local handle onto the qualified form and
  // captures the ORIGINAL bare path: the first segment then carries no
  // domain, and matches the requested handle's username.
  it('accepts the bare captured path of a rewritten local handle', () => {
    expect(
      getLocalHandleRedirect({
        actor: localActor(),
        requestedHandle: '@alice@public.example.com',
        pathname: '/@alice',
        search: ''
      })
    ).toBe('/@new.name@new.example')
  })
})
