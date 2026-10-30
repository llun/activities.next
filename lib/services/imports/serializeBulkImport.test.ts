import { describe, expect, it } from 'vitest'

import type { BulkImport } from '@/lib/database/domains/bulkImport/types'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'

import { serializeBulkImport } from './serializeBulkImport'

describe('serializeBulkImport', () => {
  const baseBulkImport: BulkImport = {
    id: 'import-123',
    actorId: 'https://llun.test/users/llun',
    type: 'following',
    overwrite: false,
    state: 'scheduled',
    originalFilename: 'following_accounts.csv',
    totalItems: 10,
    processedItems: 6,
    importedItems: 4,
    overwriteDone: false,
    nextRowIndex: 6,
    overwriteProgress: 0,
    listsPrepared: false,
    lastError: null,
    finishedAt: null,
    createdAt: 1729766400000,
    updatedAt: 1729766400000
  }

  it('serializes merge mode when overwrite is false', () => {
    const result = serializeBulkImport(baseBulkImport)
    expect(result).toEqual({
      id: 'import-123',
      type: 'following',
      mode: 'merge',
      state: 'scheduled',
      originalFilename: 'following_accounts.csv',
      totalItems: 10,
      processedItems: 6,
      importedItems: 4,
      failedItems: 2,
      createdAt: getISOTimeUTC(1729766400000),
      finishedAt: null
    })
    expect('failedRows' in result).toBe(false)
  })

  it('serializes overwrite mode when overwrite is true and formats finishedAt', () => {
    const finishedAt = 1729770000000
    const finishedImport: BulkImport = {
      ...baseBulkImport,
      overwrite: true,
      state: 'finished',
      processedItems: 10,
      importedItems: 9,
      finishedAt
    }

    const result = serializeBulkImport(finishedImport)
    expect(result).toEqual({
      id: 'import-123',
      type: 'following',
      mode: 'overwrite',
      state: 'finished',
      originalFilename: 'following_accounts.csv',
      totalItems: 10,
      processedItems: 10,
      importedItems: 9,
      failedItems: 1,
      createdAt: getISOTimeUTC(1729766400000),
      finishedAt: getISOTimeUTC(finishedAt)
    })
    expect('failedRows' in result).toBe(false)
  })

  it('includes empty failedRows array when empty array is provided', () => {
    const result = serializeBulkImport(baseBulkImport, [])
    expect(result.failedRows).toEqual([])
  })
})
