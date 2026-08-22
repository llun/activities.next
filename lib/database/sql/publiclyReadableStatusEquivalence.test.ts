import { buildPubliclyReadableStatusIdsQuery } from '@/lib/database/sql/status'
import { wherePubliclyReadableStatus } from '@/lib/database/sql/utils/publiclyReadableStatus'
import { getTestDatabaseWithInstance } from '@/lib/database/testUtils'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

// "Publicly readable" is computed two ways, and they must never disagree.
//
// `buildPubliclyReadableStatusIdsQuery` materialises the readable ids as a set;
// `wherePubliclyReadableStatus` tests the same thing correlated to one row. The
// correlated form is what lets a LIMIT bound the scan, so every paged surface
// uses it — but `getActorStatusesCount` still uses the set form, because a
// COUNT has to touch every row anyway and the correlated form costs a recursive
// CTE instantiation per Announce (measured three times slower there).
//
// Keeping two spellings of one subtle predicate is only safe with a test that
// runs both over the SAME rows and compares. That is what the sweep at the
// bottom does; the named cases above it exist so a failure says which shape
// broke rather than only that the two lists differ.
describe('publicly readable status predicate equivalence', () => {
  const { database, instance, prepare } = getTestDatabaseWithInstance()

  const actorId = 'https://llun.test/users/readable'
  const followers = `${actorId}/followers`

  // Every id the set-based form calls publicly readable, across the whole
  // table. Deliberately unscoped: the count path passes an actor-scoped target
  // set, but the predicate itself is not about the actor, and scoping here
  // would hide a disagreement on a row the fixtures reach only as a boost
  // target.
  const readableBySetForm = async () =>
    (
      await buildPubliclyReadableStatusIdsQuery({
        database: instance,
        targetStatusIds: instance('statuses').select('statuses.id')
      })
    )
      .map(({ id }: { id: string }) => id)
      .sort()

  const readableByCorrelatedForm = async () =>
    (
      await instance('statuses')
        .select('statuses.id')
        .modify(wherePubliclyReadableStatus, instance)
    )
      .map(({ id }: { id: string }) => id)
      .sort()

  const note = async (id: string, { isPublic }: { isPublic: boolean }) => {
    await database.createNote({
      id: `${actorId}/statuses/${id}`,
      url: `${actorId}/statuses/${id}`,
      actorId,
      text: id,
      to: isPublic ? [ACTIVITY_STREAM_PUBLIC] : [followers],
      cc: []
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
  ])(
    'agrees that $description is readable=$readable',
    async ({ key, readable }) => {
      const id = ids[key]
      expect(id).toBeDefined()

      const [setForm, correlatedForm] = await Promise.all([
        readableBySetForm(),
        readableByCorrelatedForm()
      ])

      expect(setForm.includes(id)).toBe(readable)
      expect(correlatedForm.includes(id)).toBe(readable)
    }
  )

  it('selects exactly the same ids by both forms across every fixture', async () => {
    const [setForm, correlatedForm] = await Promise.all([
      readableBySetForm(),
      readableByCorrelatedForm()
    ])

    // Not `toEqual` alone: an empty result on both sides would satisfy it while
    // proving nothing, and these fixtures are built so that some rows are
    // readable and some are not.
    expect(setForm.length).toBeGreaterThan(0)
    expect(setForm.length).toBeLessThan(Object.keys(ids).length)
    expect(correlatedForm).toEqual(setForm)
  })
})
