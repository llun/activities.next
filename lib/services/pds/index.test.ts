describe('PDS barrel exports', () => {
  it('keeps firehose and requestCrawl out of the barrel and does not load the database layer', async () => {
    vi.resetModules()
    vi.doMock('@/lib/database/connection', () => {
      throw new Error('PDS barrel must not import @/lib/database/connection')
    })
    vi.doMock('@/lib/database/getSQLDatabase', () => {
      throw new Error(
        'PDS barrel must not import @/lib/database/getSQLDatabase'
      )
    })

    try {
      const barrel = (await import('./index')) as Record<string, unknown>

      expect(barrel.PDS_EVENTS_NOTIFY_CHANNEL).toBe('pds_events')
      expect(barrel.createPdsEventSource).toBeUndefined()
      expect(barrel.createPollingPdsEventSource).toBeUndefined()
      expect(barrel.createPostgresPdsEventSource).toBeUndefined()
      expect(barrel.createPdsFirehoseSubscriber).toBeUndefined()
      expect(barrel.createPdsFirehoseConnectionLimiter).toBeUndefined()
      expect(barrel.encodeEventFrame).toBeUndefined()
      expect(barrel.encodeErrorFrame).toBeUndefined()
      expect(barrel.encodeInfoFrame).toBeUndefined()
      expect(barrel.requestPdsCrawl).toBeUndefined()
      expect(barrel.startPdsCrawlRequests).toBeUndefined()
    } finally {
      vi.doUnmock('@/lib/database/connection')
      vi.doUnmock('@/lib/database/getSQLDatabase')
      vi.resetModules()
    }
  })
})
