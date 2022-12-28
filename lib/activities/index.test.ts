import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getPersonFromHandle, getWebfingerSelf, sendNote } from '.'
import { MockActor } from '../stub/actor'
import { MockMastodonNote } from '../stub/note'
import { MockActivityPubPerson, MockPerson } from '../stub/person'
import { MockWebfinger } from '../stub/webfinger'
import { CreateStatus } from './actions/createStatus'

jest.mock('../config', () => {
  const originalModule = jest.requireActual('../config')
  const { MOCK_SECRET_PHASES } = jest.requireActual('../stub/actor')
  return {
    __esModule: true,
    ...originalModule,
    getConfig: jest.fn().mockReturnValue({
      host: 'llun.test',
      database: {},
      allowEmails: [],
      secretPhase: MOCK_SECRET_PHASES,
      auth: {}
    })
  }
})

enableFetchMocks()

describe('#getWebfingerSelf', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('returns self href from the webfinger', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify(MockWebfinger({ account: 'null@llun.dev' }))
    )

    const selfUrl = await getWebfingerSelf('null@llun.dev')
    expect(selfUrl).toEqual('https://llun.dev/users/null')
  })

  it('returns null for invalid account', async () => {
    const selfUrl = await getWebfingerSelf('null')
    expect(selfUrl).toBeNull()
  })

  it('returns null for not found account', async () => {
    fetchMock.mockResponseOnce('Not Found', {
      status: 404
    })

    const selfUrl = await getWebfingerSelf('null@llun.dev')
    expect(selfUrl).toBeNull()
  })
})

describe('#getPersonFromHandle', () => {
  beforeEach(() => {
    fetchMock.resetMocks()

    // https://${domain}/.well-known/webfinger
    fetchMock.mockIf(/^https:\/\/llun.test/, async (req) => {
      const url = new URL(req.url)
      if (url.pathname === '/.well-known/webfinger') {
        const account =
          url.searchParams.get('resource')?.slice('acct:'.length) || ''
        return {
          status: 200,
          body: JSON.stringify(MockWebfinger({ account }))
        }
      }
      if (url.pathname === '/users/test1') {
        return {
          status: 200,
          body: JSON.stringify(MockActivityPubPerson({ id: req.url }))
        }
      }
      return {
        status: 404,
        body: 'Not Found'
      }
    })
  })

  it('get url from webFinger and getPerson info from user id', async () => {
    const person = await getPersonFromHandle('@test1@llun.test')
    expect(person).toMatchObject(
      MockPerson({
        id: 'https://llun.test/users/test1',
        createdAt: expect.toBeNumber()
      })
    )
  })
})

describe('#sendNote', () => {
  beforeEach(() => {
    fetchMock.resetMocks()
  })

  it('fetch to shared inbox', async () => {
    fetchMock.mockResponseOnce('', {
      status: 200
    })
    const actor = MockActor({})
    const note = MockMastodonNote({
      content: '<p>Hello</p>',
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: ['https://chat.llun.dev/users/me/followers']
    })

    await sendNote({
      currentActor: actor,
      inbox: 'https://llun.dev/inbox',
      note
    })
    const [, options] = fetchMock.mock.lastCall as any
    const { body } = options
    const data = JSON.parse(body) as CreateStatus
    const object = data.object
    expect(object.content).toEqual('<p>Hello</p>')
    expect(object.to).toContain('https://www.w3.org/ns/activitystreams#Public')
    expect(object.cc).toContain('https://chat.llun.dev/users/me/followers')
  })
})
