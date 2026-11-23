// The semantic search layer listens to search document writes through this
// hook, so the database layer never imports the queue or the provider. The
// listener is set once at startup (instrumentation.ts) when the layer is
// configured; scripts and tests run without one. A listener must not throw and
// must not hold the caller: it schedules its work and returns.
export type SemanticSearchListener = {
  statusDocumentsWritten(documentIds: string[]): void
  actorUnindexed(actorId: string): void
  actorIndexed(actorId: string): void
}

let listener: SemanticSearchListener | null = null

export const setSemanticSearchListener = (
  next: SemanticSearchListener | null
) => {
  listener = next
}

export const notifyStatusDocumentsWritten = (documentIds: string[]) => {
  if (!listener || documentIds.length === 0) return
  try {
    listener.statusDocumentsWritten(documentIds)
  } catch {
    // The write has committed; the backfill fills what a lost mark leaves.
  }
}

export const notifyActorUnindexed = (actorId: string) => {
  if (!listener) return
  try {
    listener.actorUnindexed(actorId)
  } catch {
    // Search re-checks `indexable` at query time either way.
  }
}

export const notifyActorIndexed = (actorId: string) => {
  if (!listener) return
  try {
    listener.actorIndexed(actorId)
  } catch {
    // The backfill fills what a lost mark leaves.
  }
}
