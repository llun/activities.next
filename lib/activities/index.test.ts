import fetchMock, { enableFetchMocks } from 'jest-fetch-mock'

import { getPersonFromHandle, getWebfingerSelf, sendNote } from '.'
import { mockRequests } from '../stub/activities'
import { MockActor } from '../stub/actor'
import { MockMastodonNote } from '../stub/note'
import { MockPerson } from '../stub/person'
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
    mockRequests(fetchMock)
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
