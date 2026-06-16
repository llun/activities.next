import { NextRequest } from 'next/server'

import { DELETE, OPTIONS, PATCH, PUT } from './route'

const mockDatabase = {
  deleteDomainBlock: vi.fn(),
  updateDomainBlock: vi.fn()
}

vi.mock('@/lib/database', () => ({
  getDatabase: () => mockDatabase
}))

vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { email: 'admin@llun.test' }
  })
}))

vi.mock('@/lib/utils/getAdminFromSession', () => ({
  getAdminFromSession: vi.fn().mockResolvedValue({
    id: 'admin',
    email: 'admin@llun.test'
  })
}))

vi.mock('@/lib/config', () => ({
  getBaseURL: () => 'https://llun.test',
  getConfig: () => ({ host: 'llun.test', allowEmails: [] })
}))

describe('/api/v1/admin/domain_blocks/:id', () => {
  beforeEach(() => {
    mockDatabase.deleteDomainBlock.mockReset()
    mockDatabase.updateDomainBlock.mockReset()
  })

  const domainBlock = {
    id: 'block-1',
    type: 'block',
    domain: 'blocked.test',
    severity: 'suspend',
    rejectMedia: false,
    rejectReports: false,
    privateComment: null,
    publicComment: null,
    obfuscate: false,
    source: null,
    createdAt: 0,
    updatedAt: 0
  }

  it('updates only provided domain block fields', async () => {
    mockDatabase.updateDomainBlock.mockResolvedValue({
      ...domainBlock,
      publicComment: 'Updated comment'
    })

    const response = await PUT(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/block-1', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: JSON.stringify({ public_comment: 'Updated comment' })
      }),
      { params: Promise.resolve({ id: 'block-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.updateDomainBlock).toHaveBeenCalledWith({
      id: 'block-1',
      severity: undefined,
      rejectMedia: undefined,
      rejectReports: undefined,
      privateComment: undefined,
      publicComment: 'Updated comment',
      obfuscate: undefined
    })
  })

  it('clears comments when provided as blank strings', async () => {
    mockDatabase.updateDomainBlock.mockResolvedValue(domainBlock)

    const response = await PUT(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/block-1', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: JSON.stringify({
          private_comment: ' ',
          public_comment: ''
        })
      }),
      { params: Promise.resolve({ id: 'block-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.updateDomainBlock).toHaveBeenCalledWith({
      id: 'block-1',
      severity: undefined,
      rejectMedia: undefined,
      rejectReports: undefined,
      privateComment: null,
      publicComment: null,
      obfuscate: undefined
    })
  })

  // Rails `resources` maps update to both PATCH and PUT; Mastodon clients
  // commonly send PATCH. Binding PATCH to the same handler reference guarantees
  // identical behavior and that PATCH no longer returns 405.
  it('binds PATCH to the same handler as PUT', () => {
    expect(typeof PATCH).toBe('function')
    expect(PATCH).toBe(PUT)
  })

  it('advertises PATCH in the OPTIONS Access-Control-Allow-Methods header', async () => {
    const response = await OPTIONS(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/block-1', {
        method: 'OPTIONS',
        headers: { origin: 'https://llun.test' }
      })
    )

    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'PATCH'
    )
  })

  it('updates domain block fields when sent via PATCH', async () => {
    mockDatabase.updateDomainBlock.mockResolvedValue({
      ...domainBlock,
      publicComment: 'Patched comment'
    })

    const response = await PATCH(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/block-1', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          Origin: 'https://llun.test'
        },
        body: JSON.stringify({ public_comment: 'Patched comment' })
      }),
      { params: Promise.resolve({ id: 'block-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockDatabase.updateDomainBlock).toHaveBeenCalledWith({
      id: 'block-1',
      severity: undefined,
      rejectMedia: undefined,
      rejectReports: undefined,
      privateComment: undefined,
      publicComment: 'Patched comment',
      obfuscate: undefined
    })
  })

  it('returns the deleted domain block', async () => {
    mockDatabase.deleteDomainBlock.mockResolvedValue(domainBlock)

    const response = await DELETE(
      new NextRequest('https://llun.test/api/v1/admin/domain_blocks/block-1', {
        method: 'DELETE',
        headers: { Origin: 'https://llun.test' }
      }),
      { params: Promise.resolve({ id: 'block-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      id: 'block-1',
      domain: 'blocked.test',
      severity: 'suspend'
    })
  })
})
