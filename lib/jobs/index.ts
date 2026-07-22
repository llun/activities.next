import { JobHandle } from '@/lib/services/queue/type'

import { createAnnounceJob } from './createAnnounceJob'
import { createNoteJob } from './createNoteJob'
import { createPollJob } from './createPollJob'
import { createPollVoteJob } from './createPollVoteJob'
import { createRelayAnnounceJob } from './createRelayAnnounceJob'
import { deleteActorJob } from './deleteActorJob'
import { deleteObjectJob } from './deleteObjectJob'
import { fetchRemoteStatusJob } from './fetchRemoteStatusJob'
import { generateFitnessRouteHeatmapJob } from './generateFitnessRouteHeatmapJob'
import { handleQuoteRequestJob } from './handleQuoteRequestJob'
import { importFitnessFilesJob } from './importFitnessFilesJob'
import { importStravaActivityJob } from './importStravaActivityJob'
import { importStravaArchiveJob } from './importStravaArchiveJob'
import { ingestCollectionMemberJob } from './ingestCollectionMemberJob'
import {
  CREATE_ANNOUNCE_JOB_NAME,
  CREATE_NOTE_JOB_NAME,
  CREATE_POLL_JOB_NAME,
  CREATE_POLL_VOTE_JOB_NAME,
  DELETE_ACTOR_JOB_NAME,
  DELETE_OBJECT_JOB_NAME,
  FETCH_REMOTE_STATUS_JOB_NAME,
  GENERATE_FITNESS_HEATMAP_JOB_NAME,
  GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME,
  HANDLE_QUOTE_REQUEST_JOB_NAME,
  IMPORT_FITNESS_FILES_JOB_NAME,
  IMPORT_STRAVA_ACTIVITY_JOB_NAME,
  IMPORT_STRAVA_ARCHIVE_JOB_NAME,
  INGEST_COLLECTION_MEMBER_JOB_NAME,
  PROCESS_FITNESS_FILE_JOB_NAME,
  PUBLISH_SCHEDULED_STATUS_JOB_NAME,
  REGENERATE_FITNESS_MAPS_JOB_NAME,
  RELAY_ANNOUNCE_JOB_NAME,
  SEND_ANNOUNCE_JOB_NAME,
  SEND_BLOCK_JOB_NAME,
  SEND_FLAG_JOB_NAME,
  SEND_NOTE_JOB_NAME,
  SEND_QUOTE_ACCEPT_JOB_NAME,
  SEND_QUOTE_REJECT_JOB_NAME,
  SEND_QUOTE_REQUEST_JOB_NAME,
  SEND_QUOTE_REVOKE_JOB_NAME,
  SEND_UNBLOCK_JOB_NAME,
  SEND_UNDO_ANNOUNCE_JOB_NAME,
  SEND_UNDO_FOLLOW_JOB_NAME,
  SEND_UPDATE_NOTE_JOB_NAME,
  UPDATE_NOTE_JOB_NAME,
  UPDATE_POLL_JOB_NAME
} from './names'
import { processFitnessFileJob } from './processFitnessFileJob'
import { publishScheduledStatusJob } from './publishScheduledStatusJob'
import { regenerateFitnessMapsJob } from './regenerateFitnessMapsJob'
import { sendAnnounceJob } from './sendAnnounceJob'
import { sendBlockJob } from './sendBlockJob'
import { sendFlagJob } from './sendFlagJob'
import { sendNoteJob } from './sendNoteJob'
import { sendQuoteAcceptJob } from './sendQuoteAcceptJob'
import { sendQuoteRejectJob } from './sendQuoteRejectJob'
import { sendQuoteRequestJob } from './sendQuoteRequestJob'
import { sendQuoteRevokeJob } from './sendQuoteRevokeJob'
import { sendUnblockJob } from './sendUnblockJob'
import { sendUndoAnnounceJob } from './sendUndoAnnounceJob'
import { sendUndoFollowJob } from './sendUndoFollowJob'
import { sendUpdateNoteJob } from './sendUpdateNoteJob'
import { updateNoteJob } from './updateNoteJob'
import { updatePollJob } from './updatePollJob'

// Re-export JobHandle for external use
export type { JobHandle }

export const JOBS: Record<string, JobHandle> = {
  [CREATE_NOTE_JOB_NAME]: createNoteJob,
  [UPDATE_NOTE_JOB_NAME]: updateNoteJob,
  [CREATE_ANNOUNCE_JOB_NAME]: createAnnounceJob,
  [RELAY_ANNOUNCE_JOB_NAME]: createRelayAnnounceJob,
  [CREATE_POLL_JOB_NAME]: createPollJob,
  [CREATE_POLL_VOTE_JOB_NAME]: createPollVoteJob,
  [UPDATE_POLL_JOB_NAME]: updatePollJob,
  [DELETE_OBJECT_JOB_NAME]: deleteObjectJob,
  [DELETE_ACTOR_JOB_NAME]: deleteActorJob,
  [SEND_ANNOUNCE_JOB_NAME]: sendAnnounceJob,
  [SEND_BLOCK_JOB_NAME]: sendBlockJob,
  [GENERATE_FITNESS_ROUTE_HEATMAP_JOB_NAME]: generateFitnessRouteHeatmapJob,
  [GENERATE_FITNESS_HEATMAP_JOB_NAME]: generateFitnessRouteHeatmapJob,
  [PROCESS_FITNESS_FILE_JOB_NAME]: processFitnessFileJob,
  [REGENERATE_FITNESS_MAPS_JOB_NAME]: regenerateFitnessMapsJob,
  [IMPORT_FITNESS_FILES_JOB_NAME]: importFitnessFilesJob,
  [IMPORT_STRAVA_ACTIVITY_JOB_NAME]: importStravaActivityJob,
  [IMPORT_STRAVA_ARCHIVE_JOB_NAME]: importStravaArchiveJob,
  [SEND_NOTE_JOB_NAME]: sendNoteJob,
  [SEND_QUOTE_REQUEST_JOB_NAME]: sendQuoteRequestJob,
  [SEND_QUOTE_ACCEPT_JOB_NAME]: sendQuoteAcceptJob,
  [SEND_QUOTE_REJECT_JOB_NAME]: sendQuoteRejectJob,
  [SEND_QUOTE_REVOKE_JOB_NAME]: sendQuoteRevokeJob,
  [HANDLE_QUOTE_REQUEST_JOB_NAME]: handleQuoteRequestJob,
  [SEND_UPDATE_NOTE_JOB_NAME]: sendUpdateNoteJob,
  [SEND_UNDO_ANNOUNCE_JOB_NAME]: sendUndoAnnounceJob,
  [SEND_UNDO_FOLLOW_JOB_NAME]: sendUndoFollowJob,
  [SEND_UNBLOCK_JOB_NAME]: sendUnblockJob,
  [SEND_FLAG_JOB_NAME]: sendFlagJob,
  [FETCH_REMOTE_STATUS_JOB_NAME]: fetchRemoteStatusJob,
  [PUBLISH_SCHEDULED_STATUS_JOB_NAME]: publishScheduledStatusJob,
  [INGEST_COLLECTION_MEMBER_JOB_NAME]: ingestCollectionMemberJob
}
