// Re-export from new location for backward compatibility
export {
  ActorDatabase,
  CreateActorParams,
  GetActorFromEmailParams,
  GetActorFromUsernameParams,
  GetActorFromIdParams,
  IsCurrentActorFollowingParams,
  UpdateActorParams,
  DeleteActorParams,
  ScheduleActorDeletionParams,
  CancelActorDeletionParams,
  GetActorsScheduledForDeletionParams,
  StartActorDeletionParams,
  DeleteActorDataParams,
  GetActorFollowingCountParams,
  GetActorFollowersCountParams,
  GetActorSettingsParams,
  IsInternalActorParams
} from '@/lib/types/database/operations'

// Also re-export ActorSettings from rows for backward compatibility
export { ActorSettings } from '@/lib/types/database/rows'
