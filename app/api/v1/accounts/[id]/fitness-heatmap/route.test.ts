import {
  GET as routeGET,
  OPTIONS as routeOPTIONS,
  POST as routePOST
} from '@/app/api/v1/accounts/[id]/fitness-route-heatmap/route'

import { GET, OPTIONS, POST } from './route'

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn()
}))

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn()
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn()
}))

jest.mock('@/lib/services/queue', () => ({
  getQueue: () => ({ publish: jest.fn() })
}))

describe('/api/v1/accounts/[id]/fitness-heatmap legacy alias', () => {
  it('re-exports the route heatmap handlers', () => {
    expect(GET).toBe(routeGET)
    expect(OPTIONS).toBe(routeOPTIONS)
    expect(POST).toBe(routePOST)
  })
})
