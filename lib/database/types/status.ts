// Re-export from new location for backward compatibility
export {
  StatusDatabase,
  CreateNoteParams,
  UpdateNoteParams,
  CreateAnnounceParams,
  CreatePollParams,
  UpdatePollParams,
  GetStatusParams,
  GetStatusRepliesParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  DeleteStatusParams,
  HasActorAnnouncedStatusParams,
  GetFavouritedByParams,
  CreateTagParams,
  GetTagsParams,
  GetStatusReblogsCountParams,
  CreatePollAnswerParams,
  HasActorVotedParams,
  GetActorPollVotesParams,
  IncrementPollChoiceVotesParams
} from '@/lib/types/database/operations'
