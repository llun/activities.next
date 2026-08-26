import {
  MAX_PROFILE_IMAGE_URL_LENGTH,
  parseProfileImageUrl
} from '@/lib/services/accounts/profileImageUrl'
import { HostRuleConfig } from '@/lib/utils/host'

const config: HostRuleConfig = {
  host: 'llun.test',
  trustedHosts: ['alias.llun.test', '*.wildcard.test']
}

const MEDIA_URL_PREFIX = 'https://llun.test/api/v1/files/'

describe('parseProfileImageUrl', () => {
  describe('values this instance stores', () => {
    it.each([
      {
        description: 'a media URL on the configured host',
        value: 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg',
        expected: 'https://llun.test/api/v1/files/a1b2c3d4e5f60718.jpg'
      },
      // A multi-domain instance mints media URLs on the OWNING actor's domain,
      // which is not necessarily the configured primary host.
      {
        description: 'a media URL on a trusted alias host',
        value: 'https://alias.llun.test/api/v1/files/abc.jpg',
        expected: 'https://alias.llun.test/api/v1/files/abc.jpg'
      },
      {
        description: 'a media URL on a host matching a wildcard rule',
        value: 'https://tenant.wildcard.test/api/v1/files/abc.jpg',
        expected: 'https://tenant.wildcard.test/api/v1/files/abc.jpg'
      },
      {
        description: 'a thumbnail file name',
        value: `${MEDIA_URL_PREFIX}a1b2c3d4e5f60718-thumbnail.jpg`,
        expected: `${MEDIA_URL_PREFIX}a1b2c3d4e5f60718-thumbnail.jpg`
      },
      {
        description: 'surrounding whitespace, which is trimmed off',
        value: `  ${MEDIA_URL_PREFIX}abc.jpg  `,
        expected: `${MEDIA_URL_PREFIX}abc.jpg`
      },
      // `ab/..cd.webp` resolves to no parent directory, so it is an ordinary
      // stored file name rather than a traversal.
      {
        description: 'a file name that merely contains dots',
        value: `${MEDIA_URL_PREFIX}ab/..cd.webp`,
        expected: `${MEDIA_URL_PREFIX}ab/..cd.webp`
      },
      {
        description: 'a URL of exactly the maximum length',
        value: MEDIA_URL_PREFIX + 'a'.repeat(224),
        expected: MEDIA_URL_PREFIX + 'a'.repeat(224)
      }
    ])('stores $description', ({ value, expected }) => {
      expect(parseProfileImageUrl(value, config)).toEqual({
        valid: true,
        value: expected
      })
    })

    it('accepts an http media URL on a loopback development host', () => {
      // `isHostTrustedByRules` alone rejects loopback names, so a development
      // instance has to keep working through `isOwnInstanceHost`.
      expect(
        parseProfileImageUrl('http://localhost:3000/api/v1/files/abc.jpg', {
          host: 'localhost:3000'
        })
      ).toEqual({
        valid: true,
        value: 'http://localhost:3000/api/v1/files/abc.jpg'
      })
    })

    it('keeps the maximum length within what accounts.iconUrl can hold', () => {
      // The column is varchar(255) on both backends, so a longer value is a
      // PostgreSQL insert failure rather than a validation result.
      expect(MAX_PROFILE_IMAGE_URL_LENGTH).toBe(255)
    })
  })

  describe('values that clear the stored image', () => {
    it.each([
      { description: 'an empty string', value: '' },
      { description: 'a whitespace-only string', value: '   ' },
      { description: 'null', value: null }
    ])('clears the image for $description', ({ value }) => {
      expect(parseProfileImageUrl(value, config)).toEqual({
        valid: true,
        value: null
      })
    })
  })

  describe('a value the actor already has stored', () => {
    // `/settings` is one form around name, summary, both images and privacy,
    // and `ImageUploadField` resubmits the stored URL untouched. Re-validating
    // it would 422 the whole form for anyone carrying a URL stored before this
    // rule existed, losing an unrelated name edit with no error UI.
    const STALE = 'https://gravatar.example/avatar/abc.jpg'

    it('reports no change rather than refusing it', () => {
      expect(parseProfileImageUrl(STALE, config, STALE)).toEqual({
        valid: true,
        value: undefined
      })
    })

    it('still refuses a DIFFERENT value that would not pass', () => {
      expect(
        parseProfileImageUrl(
          'https://evil.example/api/v1/files/a.jpg',
          config,
          STALE
        )
      ).toEqual({ valid: false })
    })

    it('still clears when the field is submitted empty', () => {
      // The stale value has to stay removable, not become sticky.
      expect(parseProfileImageUrl('', config, STALE)).toEqual({
        valid: true,
        value: null
      })
    })

    it('still accepts a new own-instance URL replacing it', () => {
      expect(
        parseProfileImageUrl(MEDIA_URL_PREFIX + 'new.jpg', config, STALE)
      ).toEqual({
        valid: true,
        value: MEDIA_URL_PREFIX + 'new.jpg'
      })
    })

    it('matches through whitespace on the stored value', () => {
      // The rows this protects predate the validator: the old field was free
      // text parsed by a bare `z.string()`, and nothing on the read path trims,
      // so a copy-paste that carried a space is stored and resubmitted with it.
      // Comparing a trimmed submission against a raw stored value missed
      // exactly those rows.
      //
      // One case covers it: `trim()` has no leading/trailing branch, so
      // whitespace on both sides subsumes either alone.
      expect(parseProfileImageUrl(STALE, config, `  ${STALE}  `)).toEqual({
        valid: true,
        value: undefined
      })
    })

    it('clears a stored value that is only whitespace', () => {
      // Such a value is truthy but trims to '', so it collides with the empty
      // submission Remove sends. Read as "unchanged", the one control that can
      // clear it becomes a silent no-op — the field is read-only, so nothing
      // else can. The empty submission has to be decided before the match.
      expect(parseProfileImageUrl('', config, '   ')).toEqual({
        valid: true,
        value: null
      })
    })

    it('does not treat an empty stored value as a match for an empty submission', () => {
      // Guards the `currentValue &&` truthiness check: with no image stored,
      // an empty submission must still take the clear branch.
      expect(parseProfileImageUrl('', config, '')).toEqual({
        valid: true,
        value: null
      })
      expect(parseProfileImageUrl('', config, null)).toEqual({
        valid: true,
        value: null
      })
    })
  })

  it('leaves the stored image unchanged when the field is absent', () => {
    expect(parseProfileImageUrl(undefined, config)).toEqual({
      valid: true,
      value: undefined
    })
  })

  describe('values this instance refuses', () => {
    it.each([
      // An `<img src>` does not execute a `javascript:` URL, but the value is
      // also federated as `icon.url` and re-rendered by every peer that reads
      // the actor, so the scheme allowlist is decided here rather than at each
      // render site.
      { description: 'a javascript: URL', value: 'javascript:alert(1)' },
      // `new URL` parses an authority for non-special schemes too, so this one
      // has a hostname that passes the host check. The protocol test has to run
      // first for that reason.
      {
        description: 'a javascript: URL carrying our own host',
        value: 'javascript://llun.test/%0aalert(document.domain)'
      },
      {
        description: 'a data: URL',
        value: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='
      },
      { description: 'a file: URL', value: 'file:///etc/passwd' },
      { description: 'an ftp: URL', value: 'ftp://llun.test/a.jpg' },
      // The whole point of the host check: every other activities.next
      // instance serves its attachments under this exact path.
      {
        description: 'a media path on somebody else’s host',
        value: 'https://evil.example/api/v1/files/abc.jpg'
      },
      {
        description: 'a host that merely ends with our own',
        value: 'https://notllun.test/api/v1/files/abc.jpg'
      },
      {
        description: 'an internal address',
        value: 'http://169.254.169.254/api/v1/files/abc.jpg'
      },
      {
        description: 'our host but a route that serves no media',
        value: 'https://llun.test/api/v1/statuses/1'
      },
      {
        description: 'our media route with no path after it',
        value: 'https://llun.test/api/v1/files/'
      },
      // Stored verbatim and federated as `icon.url`, where a relative
      // reference names the READER's origin rather than ours.
      {
        description: 'a host-relative media path',
        value: '/api/v1/files/abc.jpg'
      },
      {
        description: 'a protocol-relative URL',
        value: '//evil.example/api/v1/files/abc.jpg'
      },
      { description: 'a bare hostname', value: 'llun.test/abc.jpg' },
      { description: 'a string that is not a URL', value: 'not a url' },
      {
        description: 'a traversing media path',
        value: 'https://llun.test/api/v1/files/../../secrets/env'
      },
      {
        description: 'a percent-encoded traversing media path',
        value: 'https://llun.test/api/v1/files/..%2f..%2fsecrets/env'
      },
      {
        description: 'a URL one character over the maximum length',
        value: MEDIA_URL_PREFIX + 'a'.repeat(225)
      }
    ])('refuses $description', ({ value }) => {
      expect(parseProfileImageUrl(value, config)).toEqual({ valid: false })
    })
  })
})
