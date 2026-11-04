import { syncHashtagCounters } from './hashtagCounters'

const createDatabase = () => ({
  increaseHashtagCounter: vi.fn().mockResolvedValue(undefined),
  decreaseHashtagCounter: vi.fn().mockResolvedValue(undefined),
  indexHashtagSearchDocuments: vi.fn().mockResolvedValue(undefined)
})

describe('syncHashtagCounters', () => {
  it('increments a newly added hashtag and reindexes the union', async () => {
    const database = createDatabase()

    await syncHashtagCounters({
      database,
      previousCounts: new Map([['keep', 1]]),
      currentNames: ['keep', 'added'],
      publiclyAddressed: true
    })

    expect(database.increaseHashtagCounter).toHaveBeenCalledTimes(1)
    expect(database.increaseHashtagCounter).toHaveBeenCalledWith({
      hashtag: 'added'
    })
    expect(database.decreaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.indexHashtagSearchDocuments).toHaveBeenCalledWith({
      hashtags: ['keep', 'added']
    })
  })

  it('decrements a removed hashtag once per stored row', async () => {
    const database = createDatabase()

    await syncHashtagCounters({
      database,
      previousCounts: new Map([['removed', 2]]),
      currentNames: [],
      publiclyAddressed: true
    })

    expect(database.decreaseHashtagCounter).toHaveBeenCalledTimes(2)
    expect(database.decreaseHashtagCounter).toHaveBeenCalledWith({
      hashtag: 'removed'
    })
    expect(database.increaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.indexHashtagSearchDocuments).toHaveBeenCalledWith({
      hashtags: ['removed']
    })
  })

  it('moves no counter for a status that is not publicly addressed', async () => {
    const database = createDatabase()

    await syncHashtagCounters({
      database,
      previousCounts: new Map([['removed', 1]]),
      currentNames: ['added'],
      publiclyAddressed: false
    })

    expect(database.increaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.decreaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.indexHashtagSearchDocuments).toHaveBeenCalledWith({
      hashtags: ['removed', 'added']
    })
  })

  it('keeps a legacy name that is still stored without moving its counter', async () => {
    const database = createDatabase()

    await syncHashtagCounters({
      database,
      previousCounts: new Map([['legacy', 1]]),
      currentNames: ['legacy'],
      publiclyAddressed: true
    })

    expect(database.increaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.decreaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.indexHashtagSearchDocuments).toHaveBeenCalledWith({
      hashtags: ['legacy']
    })
  })

  it('does nothing when there are no hashtags on either side', async () => {
    const database = createDatabase()

    await syncHashtagCounters({
      database,
      previousCounts: new Map(),
      currentNames: [],
      publiclyAddressed: true
    })

    expect(database.increaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.decreaseHashtagCounter).not.toHaveBeenCalled()
    expect(database.indexHashtagSearchDocuments).not.toHaveBeenCalled()
  })
})
