import { describe, expect, it } from 'vitest'

import { csvExportUrl } from './bulkImports'

describe('csvExportUrl', () => {
  it('builds an actor-scoped URL for each CSV export file', () => {
    expect(csvExportUrl('following_accounts.csv', 'actor/one')).toBe(
      '/api/v1/exports/following_accounts.csv?actorId=actor%2Fone'
    )
    expect(csvExportUrl('bookmarks.csv', 'actor-1')).toBe(
      '/api/v1/exports/bookmarks.csv?actorId=actor-1'
    )
  })
})
