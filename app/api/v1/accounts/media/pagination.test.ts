import {
  ALLOWED_MEDIA_LIMITS,
  DEFAULT_MEDIA_LIMIT,
  DEFAULT_PAGE,
  MAX_PAGE,
  MIN_PAGE,
  parseAccountMediaPagination
} from './pagination'

describe('parseAccountMediaPagination', () => {
  describe('defaults and missing inputs', () => {
    it('returns default pagination for undefined or null input', () => {
      expect(parseAccountMediaPagination()).toEqual({
        page: DEFAULT_PAGE,
        limit: DEFAULT_MEDIA_LIMIT
      })
      expect(parseAccountMediaPagination(null)).toEqual({
        page: DEFAULT_PAGE,
        limit: DEFAULT_MEDIA_LIMIT
      })
      expect(parseAccountMediaPagination(undefined)).toEqual({
        page: DEFAULT_PAGE,
        limit: DEFAULT_MEDIA_LIMIT
      })
    })

    it('returns default pagination for empty string', () => {
      expect(parseAccountMediaPagination('')).toEqual({
        page: 1,
        limit: 25
      })
    })

    it('returns default pagination when query has no page or limit', () => {
      expect(
        parseAccountMediaPagination('https://example.com/api/v1/accounts/media')
      ).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?other=123')).toEqual({
        page: 1,
        limit: 25
      })
    })

    it('handles empty parameter values by falling back to defaults', () => {
      expect(parseAccountMediaPagination('?page=&limit=')).toEqual({
        page: 1,
        limit: 25
      })
    })
  })

  describe('page parsing, clamping, and error handling', () => {
    it('parses valid page numbers within bounds', () => {
      expect(parseAccountMediaPagination('?page=1')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=5')).toEqual({
        page: 5,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=500')).toEqual({
        page: 500,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=10000')).toEqual({
        page: MAX_PAGE,
        limit: 25
      })
    })

    it('clamps pages below MIN_PAGE to MIN_PAGE (1)', () => {
      expect(parseAccountMediaPagination('?page=0')).toEqual({
        page: MIN_PAGE,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=-1')).toEqual({
        page: MIN_PAGE,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=-9999')).toEqual({
        page: MIN_PAGE,
        limit: 25
      })
    })

    it('clamps pages above MAX_PAGE to MAX_PAGE (10,000)', () => {
      expect(parseAccountMediaPagination('?page=10001')).toEqual({
        page: MAX_PAGE,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=999999')).toEqual({
        page: MAX_PAGE,
        limit: 25
      })
    })

    it('defaults malformed or non-numeric page input to 1', () => {
      expect(parseAccountMediaPagination('?page=abc')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=true')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=NaN')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=Infinity')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=-Infinity')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=undefined')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=[object%20Object]')).toEqual({
        page: 1,
        limit: 25
      })
    })

    it('preserves parseInt prefix acceptance for page', () => {
      expect(parseAccountMediaPagination('?page=3abc')).toEqual({
        page: 3,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=42 items')).toEqual({
        page: 42,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=10000abc')).toEqual({
        page: 10000,
        limit: 25
      })
      expect(parseAccountMediaPagination('?page=20000abc')).toEqual({
        page: 10000,
        limit: 25
      })
    })
  })

  describe('limit validation and allowed sets', () => {
    it.each(ALLOWED_MEDIA_LIMITS)(
      'accepts allowed limit %i',
      (allowedLimit) => {
        expect(parseAccountMediaPagination(`?limit=${allowedLimit}`)).toEqual({
          page: 1,
          limit: allowedLimit
        })
      }
    )

    it('preserves parseInt prefix acceptance for allowed limits', () => {
      expect(parseAccountMediaPagination('?limit=25px')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=50items')).toEqual({
        page: 1,
        limit: 50
      })
      expect(parseAccountMediaPagination('?limit=100%')).toEqual({
        page: 1,
        limit: 100
      })
    })

    it('defaults unsupported limits to 25', () => {
      expect(parseAccountMediaPagination('?limit=10')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=20')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=30')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=75')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=200')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=0')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=-25')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=-50')).toEqual({
        page: 1,
        limit: 25
      })
    })

    it('defaults malformed or non-numeric limit to 25', () => {
      expect(parseAccountMediaPagination('?limit=abc')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=NaN')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=Infinity')).toEqual({
        page: 1,
        limit: 25
      })
      expect(parseAccountMediaPagination('?limit=null')).toEqual({
        page: 1,
        limit: 25
      })
    })
  })

  describe('input format compatibility', () => {
    it('accepts a full URL string', () => {
      const res = parseAccountMediaPagination(
        'https://myinstance.social/api/v1/accounts/media?page=3&limit=50'
      )
      expect(res).toEqual({ page: 3, limit: 50 })
    })

    it('accepts a relative URL string', () => {
      const res = parseAccountMediaPagination(
        '/api/v1/accounts/media?page=4&limit=100'
      )
      expect(res).toEqual({ page: 4, limit: 100 })
    })

    it('accepts a query string with leading ?', () => {
      const res = parseAccountMediaPagination('?page=2&limit=50')
      expect(res).toEqual({ page: 2, limit: 50 })
    })

    it('accepts a query string without leading ?', () => {
      const res = parseAccountMediaPagination('page=2&limit=50')
      expect(res).toEqual({ page: 2, limit: 50 })
    })

    it('accepts a URL instance', () => {
      const url = new URL(
        'https://myinstance.social/api/v1/accounts/media?page=7&limit=50'
      )
      expect(parseAccountMediaPagination(url)).toEqual({ page: 7, limit: 50 })
    })

    it('accepts a URLSearchParams instance', () => {
      const params = new URLSearchParams('page=8&limit=100')
      expect(parseAccountMediaPagination(params)).toEqual({
        page: 8,
        limit: 100
      })
    })

    it('accepts a Request instance', () => {
      const request = new Request(
        'https://myinstance.social/api/v1/accounts/media?page=9&limit=50'
      )
      expect(parseAccountMediaPagination(request)).toEqual({
        page: 9,
        limit: 50
      })
    })

    it('accepts a NextRequest-like object with nextUrl', () => {
      const nextRequest = {
        nextUrl: new URL(
          'https://myinstance.social/api/v1/accounts/media?page=6&limit=100'
        )
      }
      expect(
        parseAccountMediaPagination(nextRequest as unknown as Request)
      ).toEqual({
        page: 6,
        limit: 100
      })
    })

    it('isolates hash fragments so fragments never leak into query parameters', () => {
      // URL with query and hash containing conflicting parameters
      expect(
        parseAccountMediaPagination(
          'https://myinstance.social/api/v1/accounts/media?page=2#section&limit=100'
        )
      ).toEqual({
        page: 2,
        limit: 25
      })

      // URL with only a hash fragment (no query string)
      expect(
        parseAccountMediaPagination(
          'https://myinstance.social/api/v1/accounts/media#page=5&limit=100'
        )
      ).toEqual({
        page: 1,
        limit: 25
      })

      // Query string with hash fragment at the end
      expect(
        parseAccountMediaPagination('page=3&limit=50#hash&limit=100')
      ).toEqual({
        page: 3,
        limit: 50
      })

      // Request object with hash in URL
      const requestWithHash = new Request(
        'https://myinstance.social/api/v1/accounts/media?page=4#something&limit=100'
      )
      expect(parseAccountMediaPagination(requestWithHash)).toEqual({
        page: 4,
        limit: 25
      })
    })
  })

  describe('guarantee of finite values (no NaN reaches output)', () => {
    const edgeCases = [
      '',
      '?',
      '?page=NaN&limit=NaN',
      '?page=Infinity&limit=-Infinity',
      '?page=-Infinity&limit=Infinity',
      '?page=foo&limit=bar',
      '?page=&limit=',
      '?page=-0&limit=+0',
      '?page=1.5&limit=25.9'
    ]

    it.each(edgeCases)('ensures finite values for input %j', (input) => {
      const result = parseAccountMediaPagination(input)
      expect(Number.isFinite(result.page)).toBe(true)
      expect(Number.isFinite(result.limit)).toBe(true)
      expect(Number.isNaN(result.page)).toBe(false)
      expect(Number.isNaN(result.limit)).toBe(false)
      expect(result.page).toBeGreaterThanOrEqual(1)
      expect(result.page).toBeLessThanOrEqual(10000)
      expect(ALLOWED_MEDIA_LIMITS).toContain(result.limit)
    })
  })
})
