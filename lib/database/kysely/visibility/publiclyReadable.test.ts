import { kyselyFor } from '@/lib/database/kysely'
import {
  publiclyReadableStatus,
  publiclyReadableStatusIds
} from '@/lib/database/kysely/visibility/publiclyReadable'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

// "Publicly readable" has two Kysely forms, and they must never disagree.
//
// `publiclyReadableStatus` tests one row, correlated to it. That is what lets
// a LIMIT bound the scan, so the local public timeline and the public
// collection feed read through it. `publiclyReadableStatusIds` materialises
// the readable ids of a target set, which suits a caller with no ordered bound
// to stop early on: `getActorStatusesCount` (a COUNT touches every row anyway,
// and the correlated form costs a recursive CTE instantiation per Announce)
// and the anonymous reblogged-by list.
//
// Each named case says which shape of row decides the answer; the sweep at the
// bottom runs both forms over every fixture and checks the whole readable set.
// The set is the one the Knex forms (a set form and a correlated form, removed
// with their last caller) selected over the same rows.
describe('publicly readable status predicates', () => {
  const { database, instance, prepare } = getTestDatabaseWithInstance()

  const actorId = 'https://llun.test/users/readable'
  const followers = `${actorId}/followers`

  // Deliberately unscoped: the count path passes an actor-scoped target set,
  // but the predicate itself is not about the actor, and scoping here would
  // hide a row the fixtures reach only as a boost target.
  const readableByKyselyForm = async () =>
    (
      await kyselyFor(instance)
        .selectFrom('statuses')
        .select('statuses.id')
        .where((eb) => publiclyReadableStatus(kyselyFor(instance), eb))
        .execute()
    )
      .map(({ id }) => id as string)
      .sort()

  // The Kysely twin of the set form, over the same unscoped target set.
  const readableByKyselySetForm = async () => {
    const db = kyselyFor(instance)
    return (
      await publiclyReadableStatusIds(
        db,
        db.selectFrom('statuses').select('statuses.id')
      ).execute()
    )
      .map(({ id }) => id as string)
      .sort()
  }

  // The set form over a target set that holds only the Announces, so every
  // chain it follows leaves the target set at its first hop: the recursion has
  // to read the boosted statuses from the whole table and still answer with
  // the Announce it started from.
  const readableAnnouncesBySetForm = async () => {
    const db = kyselyFor(instance)
    return (
      await publiclyReadableStatusIds(
        db,
        db
          .selectFrom('statuses')
          .select('statuses.id')
          .where('statuses.type', '=', 'Announce')
      ).execute()
    )
      .map(({ id }) => id as string)
      .sort()
  }

  const note = async (
    id: string,
    { isPublic, cc = [] }: { isPublic: boolean; cc?: string[] }
  ) => {
    await database.createNote({
      id: `${actorId}/statuses/${id}`,
      url: `${actorId}/statuses/${id}`,
      actorId,
      text: id,
      to: isPublic ? [ACTIVITY_STREAM_PUBLIC] : [followers],
      cc
    })
    return `${actorId}/statuses/${id}`
  }

  const announce = async (
    id: string,
    originalStatusId: string,
    { isPublic }: { isPublic: boolean }
  ) => {
    await database.createAnnounce({
      id: `${actorId}/statuses/${id}`,
      actorId,
      originalStatusId,
      to: isPublic ? [ACTIVITY_STREAM_PUBLIC] : [followers],
      cc: []
    })
    return `${actorId}/statuses/${id}`
  }

  const ids: Record<string, string> = {}

  beforeAll(async () => {
    await prepare()
    await database.migrate()
    await database.createActor({
      actorId,
      username: 'readable',
      domain: 'llun.test',
      publicKey: 'publicKey-readable',
      privateKey: 'privateKey-readable',
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: 'https://llun.test/inbox',
      followersUrl: followers,
      createdAt: Date.now()
    })

    ids.publicNote = await note('public-note', { isPublic: true })
    ids.privateNote = await note('private-note', { isPublic: false })
    // Public only through the compact `as:Public` form, and only in `cc`: the
    // recipient test takes either spelling, in any field.
    ids.compactPublicNote = await note('compact-public-note', {
      isPublic: false,
      cc: [ACTIVITY_STREAM_PUBLIC_COMPACT]
    })
    ids.boostOfCompactPublic = await announce(
      'boost-compact-public',
      ids.compactPublicNote,
      { isPublic: true }
    )

    ids.boostOfPublic = await announce('boost-public', ids.publicNote, {
      isPublic: true
    })
    ids.boostOfPrivate = await announce('boost-private', ids.privateNote, {
      isPublic: true
    })
    // The boost itself is followers-only. Its target is public, but a reader
    // who cannot see the boost cannot read it.
    ids.privateBoost = await announce('private-boost', ids.publicNote, {
      isPublic: false
    })

    // Depth 2: a boost of a boost. Nothing local writes one, but a remote
    // server can send it, which is the whole reason the chain recurses.
    ids.boostOfBoost = await announce('boost-of-boost', ids.boostOfPublic, {
      isPublic: true
    })
    // Depth 2 through a hop that is not itself public: unreadable, even though
    // the note at the end of the chain is.
    ids.boostOfPrivateBoost = await announce(
      'boost-of-private-boost',
      ids.privateBoost,
      { isPublic: true }
    )

    // Depth 2 whose second hop is not public: the chain starts at a public
    // boost, but the note that boost points at is followers-only, so the
    // chain never reaches a public note.
    ids.boostOfBoostOfPrivate = await announce(
      'boost-of-boost-of-private',
      ids.boostOfPrivate,
      { isPublic: true }
    )

    // Legacy shape: before `20260517000000_add_status_original_status_id.js`
    // the boosted id lived only in `content`. `COALESCE` is what still reads
    // it, and no writer produces this row today.
    ids.legacyBoost = await announce('legacy-boost', ids.publicNote, {
      isPublic: true
    })
    await instance('statuses')
      .where('id', ids.legacyBoost)
      .update({ originalStatusId: null })

    // The two pointer columns DISAGREE. `20260517000000` backfilled
    // `originalStatusId` by JSON-parsing `content` and left the raw body
    // behind, so only `originalStatusId` names the boosted status — which is
    // why the COALESCE order matters and why this row has to be hand-written.
    ids.disagreeingBoost = await announce('disagreeing-boost', ids.publicNote, {
      isPublic: true
    })
    await instance('statuses')
      .where('id', ids.disagreeingBoost)
      .update({ content: ids.privateNote })

    // A cycle. `UNION` (not `UNION ALL`) is what stops the recursion; if this
    // ever regresses the test does not fail, it hangs.
    ids.cycleA = await announce('cycle-a', ids.publicNote, { isPublic: true })
    ids.cycleB = await announce('cycle-b', ids.cycleA, { isPublic: true })
    await instance('statuses')
      .where('id', ids.cycleA)
      .update({ originalStatusId: ids.cycleB, content: ids.cycleB })

    // A boost of itself — the degenerate cycle.
    ids.selfBoost = await announce('self-boost', ids.publicNote, {
      isPublic: true
    })
    await instance('statuses')
      .where('id', ids.selfBoost)
      .update({ originalStatusId: ids.selfBoost, content: ids.selfBoost })

    // A boost pointing at a row that does not exist.
    ids.danglingBoost = await announce('dangling-boost', ids.publicNote, {
      isPublic: true
    })
    await instance('statuses')
      .where('id', ids.danglingBoost)
      .update({
        originalStatusId: `${actorId}/statuses/gone`,
        content: `${actorId}/statuses/gone`
      })
  })

  afterAll(async () => {
    await database.destroy()
  })

  it.each([
    { description: 'a public note', key: 'publicNote', readable: true },
    {
      description: 'a followers-only note',
      key: 'privateNote',
      readable: false
    },
    {
      description: 'a note public only through a compact cc',
      key: 'compactPublicNote',
      readable: true
    },
    {
      description: 'a boost of a compact-public note',
      key: 'boostOfCompactPublic',
      readable: true
    },
    {
      description: 'a boost of a public note',
      key: 'boostOfPublic',
      readable: true
    },
    {
      description: 'a boost of a private note',
      key: 'boostOfPrivate',
      readable: false
    },
    {
      description: 'a followers-only boost',
      key: 'privateBoost',
      readable: false
    },
    {
      description: 'a boost of a public boost',
      key: 'boostOfBoost',
      readable: true
    },
    {
      description: 'a boost through a private hop',
      key: 'boostOfPrivateBoost',
      readable: false
    },
    {
      description: 'a boost of a public boost of a private note',
      key: 'boostOfBoostOfPrivate',
      readable: false
    },
    {
      description: 'a legacy content-only pointer',
      key: 'legacyBoost',
      readable: true
    },
    {
      description: 'disagreeing pointer columns',
      key: 'disagreeingBoost',
      readable: true
    },
    { description: 'a boost cycle', key: 'cycleA', readable: false },
    {
      description: 'a self-referencing boost',
      key: 'selfBoost',
      readable: false
    },
    { description: 'a dangling pointer', key: 'danglingBoost', readable: false }
  ])('reads $description as readable=$readable', async ({ key, readable }) => {
    const id = ids[key]
    expect(id).toBeDefined()

    const [kyselyForm, kyselySetForm] = await Promise.all([
      readableByKyselyForm(),
      readableByKyselySetForm()
    ])

    expect(kyselyForm.includes(id)).toBe(readable)
    expect(kyselySetForm.includes(id)).toBe(readable)
  })

  it('selects exactly the readable fixtures by both forms', async () => {
    const [kyselyForm, kyselySetForm] = await Promise.all([
      readableByKyselyForm(),
      readableByKyselySetForm()
    ])

    // Every other fixture, the second row of the boost cycle included, is not
    // readable.
    const readable = [
      ids.publicNote,
      ids.compactPublicNote,
      ids.boostOfCompactPublic,
      ids.boostOfPublic,
      ids.boostOfBoost,
      ids.legacyBoost,
      ids.disagreeingBoost
    ].sort()
    expect(kyselyForm).toEqual(readable)
    expect(kyselySetForm).toEqual(readable)
  })

  it('selects the readable boosts by the set form over a target set of Announces', async () => {
    // The readable boosts among the fixtures, and none of the notes they
    // reach: the answer is the target, not the end of its chain.
    expect(await readableAnnouncesBySetForm()).toEqual(
      [
        ids.boostOfCompactPublic,
        ids.boostOfPublic,
        ids.boostOfBoost,
        ids.legacyBoost,
        ids.disagreeingBoost
      ].sort()
    )
  })
})
