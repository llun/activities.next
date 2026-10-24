import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'

// Mastodon's ActivityPub::MoveSerializer: the activity carries no `to`; remote
// servers learn the move from `object`/`target` after re-reading the origin.
export const getMoveActivity = ({
  migrationId,
  originActorId,
  targetActorId
}: {
  migrationId: string
  originActorId: string
  targetActorId: string
}) => ({
  '@context': ACTIVITY_STREAM_URL,
  id: `${originActorId}#moves/${migrationId}`,
  type: 'Move',
  actor: originActorId,
  object: originActorId,
  target: targetActorId
})
