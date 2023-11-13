import { IncomingHttpHeaders } from "http"
import { headerHost } from "./guard"

describe('#headerHost', () => {
  describe('standard headers', () => {
    it('returns host value from Headers', () => {
      const headers = new Headers([['Host', 'test.llun.dev']])
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })
  
    it('returns X-Forwarded-Host if it is availbled instead of Host', () => {
      const headers = new Headers([['Host', 'test.llun.dev'], ['X-Forwarded-Host', 'test-forwarded.llun.dev']])
      expect(headerHost(headers)).toEqual('test-forwarded.llun.dev')
    })
  
    it('returns host from custom Activity.next header host', () => {
      const headers = new Headers([['Host', 'test.llun.dev'], ['X-Activity-Next-Host', 'test-custom.llun.dev']])
      expect(headerHost(headers)).toEqual('test-custom.llun.dev')
    })
  })

  describe('node headers', () => {
    it('returns host value from Headers', () => {
      const headers = {
        'Host': 'test.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test.llun.dev')
    })

    it('returns X-Forwarded-Host if it is availabled instead of host', () => {
      const headers = {
        'Host': 'test.llun.dev',
        'X-Forwarded-Host': 'test-forwarded.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test-forwarded.llun.dev')
    })
    
    it('returns host from custom Activity.next header host', () => {
      const headers = {
        'Host': 'test.llun.dev',
        'X-Activity-Next-Host': 'test-custom.llun.dev'
      } as IncomingHttpHeaders
      expect(headerHost(headers)).toEqual('test-custom.llun.dev')
    })
  })
})