import {
  GET as routeGET,
  OPTIONS as routeOPTIONS
} from '@/app/api/v1/accounts/[id]/fitness-route-heatmaps/route'

import { GET, OPTIONS } from './route'

jest.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: jest.fn()
}))

jest.mock('@/lib/database', () => ({
  getDatabase: jest.fn()
}))

jest.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: jest.fn()
}))

describe('/api/v1/accounts/[id]/fitness-heatmaps legacy alias', () => {
  it('re-exports the route heatmap history handlers', () => {
    expect(GET).toBe(routeGET)
    expect(OPTIONS).toBe(routeOPTIONS)
  })
})
