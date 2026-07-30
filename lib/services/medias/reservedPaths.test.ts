import { isReservedFitnessMediaPath } from '@/lib/services/medias/reservedPaths'

describe('isReservedFitnessMediaPath', () => {
  // The media route has no access control and, with a public hostname
  // configured, 308-redirects to the CDN — so anything it lets through reaches
  // the bytes that `GET /api/v1/fitness-files/:id` restricts to their owner.
  // Each encoding below defeated a check written against the raw request path,
  // because the collapse happens later: in the WHATWG URL parser when the
  // `Location` is built, or at the origin when it percent-decodes the key.
  it.each([
    {
      description: 'the plain prefix',
      userPath: 'fitness/2026-07-30/a1b2c3d4e5f60718.gpx'
    },
    { description: 'the bare prefix segment', userPath: 'fitness' },
    {
      description: 'a differently-cased prefix',
      userPath: 'FITNESS/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'a backslash separator, which the URL parser honours',
      userPath: 'medias\\..\\fitness/a1b2c3d4e5f60718.gpx'
    },
    {
      description:
        'percent-encoded dot segments, which the URL parser resolves',
      userPath: 'medias/%2e%2e/fitness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'double-encoded dot segments',
      userPath: 'medias/%252e%252e/fitness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'a percent-encoded prefix, which the origin decodes',
      userPath: '%66itness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'a double-encoded prefix',
      userPath: '%2566itness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'a leading current-directory segment',
      userPath: './fitness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'traversal back into the prefix',
      userPath: 'a/../fitness/a1b2c3d4e5f60718.gpx'
    },
    { description: 'doubled separators', userPath: '//fitness/x.gpx' },
    {
      description: 'a malformed escape elsewhere in the path',
      // Decoding used to run over the whole joined path, so `decodeURIComponent`
      // threw on `%zz` and returned everything undecoded — one bad segment
      // protected every other one, and the URL parser then dropped the `?%zz`.
      userPath: '%66itness/x.gpx?%zz'
    },
    {
      description: 'a malformed escape in a fragment',
      userPath: '%66itness/x.gpx#%zz'
    },
    {
      description: 'a malformed escape in its own segment',
      userPath: '%66itness/%zz/x.gpx'
    },
    {
      description: 'a tab, which the URL parser strips from a path',
      userPath: 'fit\tness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'a newline, which the URL parser strips from a path',
      userPath: 'fit\nness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'a carriage return, which the URL parser strips',
      userPath: 'fit\rness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'an encoded separator hiding the prefix in one segment',
      userPath: '%2Ffitness/a1b2c3d4e5f60718.gpx'
    },
    {
      description: 'a double-encoded separator',
      userPath: '%252Ffitness/a1b2c3d4e5f60718.gpx'
    }
  ])('reserves $description', ({ userPath }: { userPath: string }) => {
    expect(isReservedFitnessMediaPath(userPath)).toBe(true)
  })

  it.each([
    {
      description: 'an ordinary media object',
      userPath: 'medias/2026-07-30/a1b2c3d4e5f60718.webp'
    },
    {
      description: 'a key that merely starts with the same letters',
      userPath: 'fitnessed/a1b2c3d4e5f60718.webp'
    },
    {
      description: 'the prefix below the top level',
      userPath: 'medias/fitness/a1b2c3d4e5f60718.webp'
    },
    {
      description: 'a malformed escape that cannot be decoded',
      // `decodeURIComponent` throws here; the matcher must not, and must not
      // treat an undecodable key as reserved either.
      userPath: '%zz/a1b2c3d4e5f60718.webp'
    },
    { description: 'an empty path', userPath: '' },
    {
      description: 'a key whose original name carried a percent',
      // Media keys are server-generated hex, but decoding must not turn a stored
      // `%25` into a match by over-eagerly folding legitimate escapes.
      userPath: 'medias/2026-07-30/50%25-off.webp'
    }
  ])('allows $description', ({ userPath }: { userPath: string }) => {
    expect(isReservedFitnessMediaPath(userPath)).toBe(false)
  })
})
