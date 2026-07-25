import { getReactionGroupKey } from '@/lib/services/reactions/reactionGroupKey'

describe('getReactionGroupKey', () => {
  const shortStatusId = 'https://remote.test/users/alice/statuses/1'

  it('keeps the readable form while it fits the column', () => {
    expect(getReactionGroupKey(shortStatusId, '🔥')).toBe(
      `emoji_reaction:${shortStatusId}:🔥`
    )
  })

  it.each([
    {
      description: 'a long status id',
      statusId: `https://remote.test/users/alice/statuses/${'s'.repeat(300)}`,
      name: '🔥'
    },
    {
      description: 'a long reaction name',
      statusId: shortStatusId,
      name: `${'x'.repeat(60)}@${'d'.repeat(180)}`
    }
  ])(
    'falls back to a bounded digest for $description',
    ({ statusId, name }) => {
      const groupKey = getReactionGroupKey(statusId, name)
      // notifications.groupKey is varchar(255); Postgres rejects an overflow and
      // SQLite silently accepts it, so the bound has to hold here.
      expect(groupKey.length).toBeLessThanOrEqual(255)
      expect(getReactionGroupKey(statusId, name)).toBe(groupKey)
    }
  )

  it('gives different groups to different reactions on one status', () => {
    const statusId = `https://remote.test/users/alice/statuses/${'s'.repeat(300)}`
    expect(getReactionGroupKey(statusId, '🔥')).not.toBe(
      getReactionGroupKey(statusId, '🎉')
    )
  })
})
