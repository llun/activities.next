// Ceilings that keep every read of a collection bounded. The public collection
// APIs and the FEP-7aa9 federation endpoints answer anonymous requests, so the
// size of what they load and serialize must not be something one account can
// grow without limit. They are enforced where the rows are written
// (`createCollection`, `addCollectionMembers`), not in a route, so every caller
// is covered.

// Collections one actor may own. The actor's `featuredCollections` endpoint
// lists them all in one OrderedCollection.
export const MAX_COLLECTIONS_PER_ACTOR = 100

// Members (any consent state) one collection may hold. A FeaturedCollection
// object lists every approved member in a single response.
export const MAX_COLLECTION_MEMBERS = 500

// Thrown by the storage layer when a write would pass one of the ceilings
// above; routes answer it with a 422.
export class CollectionLimitError extends Error {
  readonly limit: 'collections' | 'members'

  constructor(limit: 'collections' | 'members') {
    super(
      limit === 'collections'
        ? `An account may own at most ${MAX_COLLECTIONS_PER_ACTOR} collections`
        : `A collection may hold at most ${MAX_COLLECTION_MEMBERS} accounts`
    )
    this.name = 'CollectionLimitError'
    this.limit = limit
  }
}
