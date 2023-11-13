import { headerHost } from "./guard"

describe('#headerHost', () => {
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