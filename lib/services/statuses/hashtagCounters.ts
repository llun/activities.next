import { Database } from '@/lib/database/types'

type HashtagCounterDatabase = Pick<
  Database,
  | 'increaseHashtagCounter'
  | 'decreaseHashtagCounter'
  | 'indexHashtagSearchDocuments'
>

/**
 * Moves the hashtag counters and reindexes hashtag search for a status edit.
 *
 * `previousCounts` is the multiset of the status's stored hashtag names before
 * the edit (one entry per stored row, so rows that differ only in case count
 * separately), and `currentNames` the deduplicated names after it. Both sides
 * are bare lowercase names, the way the counters are keyed. Each counter moves
 * by the difference to what the old rows had counted, and only when the status
 * is publicly addressed — the same rule Create and Delete use, so a legacy bare
 * `Public` row moves nothing. The union of old and new names is reindexed
 * either way, because search must forget a name the edit removed.
 */
export const syncHashtagCounters = async ({
  database,
  previousCounts,
  currentNames,
  publiclyAddressed
}: {
  database: HashtagCounterDatabase
  previousCounts: ReadonlyMap<string, number>
  currentNames: readonly string[]
  publiclyAddressed: boolean
}): Promise<void> => {
  const currentSet = new Set(currentNames)
  if (publiclyAddressed) {
    for (const hashtag of currentNames) {
      const delta = 1 - (previousCounts.get(hashtag) ?? 0)
      for (let i = 0; i < delta; i++) {
        await database.increaseHashtagCounter({ hashtag })
      }
      for (let i = 0; i > delta; i--) {
        await database.decreaseHashtagCounter({ hashtag })
      }
    }
    for (const [hashtag, count] of previousCounts) {
      if (currentSet.has(hashtag)) continue
      for (let i = 0; i < count; i++) {
        await database.decreaseHashtagCounter({ hashtag })
      }
    }
  }

  const affected = [...new Set([...previousCounts.keys(), ...currentNames])]
  if (affected.length > 0) {
    await database.indexHashtagSearchDocuments({ hashtags: affected })
  }
}
