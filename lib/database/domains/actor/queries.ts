import {
  getActorFollowersCount,
  getActorFollowingCount,
  getNodeInfoStats,
  hasActorCounters,
  setActorCounters
} from '@/lib/database/domains/actor/counters'
import { deleteActorData } from '@/lib/database/domains/actor/deletion'
import { getFederationSigningActor } from '@/lib/database/domains/actor/federationSigner'
import {
  getActorDeletionStatus,
  getActorFromEmail,
  getActorFromId,
  getActorFromUsername,
  getActorIdByPublicId,
  getActorIdsByPublicIds,
  getActorPublicIds,
  getActorSettings,
  getActorsFromIds,
  getActorsScheduledForDeletion,
  getNotificationPolicy,
  isCurrentActorFollowing
} from '@/lib/database/domains/actor/lookups'
import {
  getLocalMastodonActors,
  getMastodonActor,
  getMastodonActorFromId,
  getMastodonActors,
  getMastodonActorsFromIds
} from '@/lib/database/domains/actor/mastodon'
import {
  cancelActorDeletion,
  claimActorMove,
  clearActorMove,
  createActor,
  deleteActor,
  markActorMoveQueued,
  markActorMoveVerified,
  markActorProfileFieldsVerified,
  scheduleActorDeletion,
  startActorDeletion,
  updateActor,
  updateActorWithPrevious,
  updateNotificationPolicy
} from '@/lib/database/domains/actor/writes'

// The facade getSQLDatabase binds with bindDb(). The row mapper getActor
// (pure and synchronous) is added to the facade from ./rows.ts.
export const actorQueries = {
  createActor,
  getActorFromEmail,
  isCurrentActorFollowing,
  getActorFromUsername,
  getFederationSigningActor,
  getActorFromId,
  getActorsFromIds,
  getActorIdByPublicId,
  getActorIdsByPublicIds,
  getActorPublicIds,
  getMastodonActorFromId,
  getMastodonActorsFromIds,
  getMastodonActor,
  getLocalMastodonActors,
  getMastodonActors,
  updateActor,
  updateActorWithPrevious,
  claimActorMove,
  clearActorMove,
  markActorMoveVerified,
  markActorMoveQueued,
  markActorProfileFieldsVerified,
  deleteActor,
  setActorCounters,
  hasActorCounters,
  getActorFollowingCount,
  getActorFollowersCount,
  getActorSettings,
  getNotificationPolicy,
  updateNotificationPolicy,
  scheduleActorDeletion,
  cancelActorDeletion,
  startActorDeletion,
  getActorsScheduledForDeletion,
  getActorDeletionStatus,
  deleteActorData,
  getNodeInfoStats
}
