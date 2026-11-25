import { TEST_DOMAIN } from '@/lib/stub/const'

import {
  getMovedToHost,
  getPlcOperationPdsEndpoint,
  isPlcOperationPointingAway
} from './moved'

const PDS_HOSTNAME = `pds.${TEST_DOMAIN}`

const operation = (endpoint: unknown) =>
  JSON.stringify({
    type: 'plc_operation',
    services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint } }
  })

describe('moved', () => {
  let originalPdsEnv: string | undefined

  beforeEach(() => {
    originalPdsEnv = process.env.ACTIVITIES_BLUESKY_PDS
    process.env.ACTIVITIES_BLUESKY_PDS = JSON.stringify({
      [TEST_DOMAIN]: { enabled: true, hostname: PDS_HOSTNAME }
    })
  })

  afterEach(() => {
    if (originalPdsEnv === undefined) {
      delete process.env.ACTIVITIES_BLUESKY_PDS
    } else {
      process.env.ACTIVITIES_BLUESKY_PDS = originalPdsEnv
    }
  })

  describe('getPlcOperationPdsEndpoint', () => {
    it('returns the https endpoint URL', () => {
      expect(
        getPlcOperationPdsEndpoint(operation('https://bsky.social'))?.origin
      ).toBe('https://bsky.social')
    })

    it('keeps a port in the endpoint', () => {
      expect(
        getPlcOperationPdsEndpoint(operation('https://pds.example:8443'))?.host
      ).toBe('pds.example:8443')
    })

    it('returns null for a non-https endpoint', () => {
      expect(
        getPlcOperationPdsEndpoint(operation('http://bsky.social'))
      ).toBeNull()
    })

    it('returns null when the services are missing', () => {
      expect(
        getPlcOperationPdsEndpoint(
          JSON.stringify({ type: 'plc_operation', services: {} })
        )
      ).toBeNull()
      expect(getPlcOperationPdsEndpoint(JSON.stringify({}))).toBeNull()
    })

    it('returns null for null, empty, or invalid JSON', () => {
      expect(getPlcOperationPdsEndpoint(null)).toBeNull()
      expect(getPlcOperationPdsEndpoint('')).toBeNull()
      expect(getPlcOperationPdsEndpoint('not json')).toBeNull()
    })
  })

  describe('getMovedToHost', () => {
    it('returns the destination host when the endpoint is another origin', () => {
      expect(
        getMovedToHost({
          domain: TEST_DOMAIN,
          plcOperation: operation('https://bsky.social')
        })
      ).toBe('bsky.social')
    })

    it('keeps a port in the destination host', () => {
      expect(
        getMovedToHost({
          domain: TEST_DOMAIN,
          plcOperation: operation('https://pds.example:8443')
        })
      ).toBe('pds.example:8443')
    })

    it('returns null while the endpoint is this server', () => {
      expect(
        getMovedToHost({
          domain: TEST_DOMAIN,
          plcOperation: operation(`https://${PDS_HOSTNAME}`)
        })
      ).toBeNull()
    })

    it('returns null without a stored operation', () => {
      expect(
        getMovedToHost({ domain: TEST_DOMAIN, plcOperation: null })
      ).toBeNull()
    })

    it('treats an https endpoint as moved when the domain has no PDS config', () => {
      delete process.env.ACTIVITIES_BLUESKY_PDS
      expect(
        getMovedToHost({
          domain: 'unconfigured.example',
          plcOperation: operation('https://bsky.social')
        })
      ).toBe('bsky.social')
    })
  })

  describe('isPlcOperationPointingAway', () => {
    it('is true when the endpoint is another origin', () => {
      expect(
        isPlcOperationPointingAway(
          operation('https://bsky.social'),
          TEST_DOMAIN
        )
      ).toBe(true)
    })

    it('is false while the endpoint is this server', () => {
      expect(
        isPlcOperationPointingAway(
          operation(`https://${PDS_HOSTNAME}`),
          TEST_DOMAIN
        )
      ).toBe(false)
    })

    it('is false for a non-https endpoint or no operation', () => {
      expect(
        isPlcOperationPointingAway(operation('http://bsky.social'), TEST_DOMAIN)
      ).toBe(false)
      expect(isPlcOperationPointingAway(null, TEST_DOMAIN)).toBe(false)
    })

    it('is true for an https endpoint when the domain has no PDS config', () => {
      delete process.env.ACTIVITIES_BLUESKY_PDS
      expect(
        isPlcOperationPointingAway(
          operation('https://bsky.social'),
          'unconfigured.example'
        )
      ).toBe(true)
    })
  })
})
