// Parameter and result types of the list domain (Mastodon lists, their
// members and the materialized list timeline). lib/types/database/operations.ts
// re-exports them, so existing imports keep working.
import type { List, ListRepliesPolicy } from '@/lib/types/domain/list'
import type { Status } from '@/lib/types/domain/status'
import type * as Mastodon from '@/lib/types/mastodon'

export type CreateListParams = {
  actorId: string
  title: string
  repliesPolicy?: ListRepliesPolicy
  exclusive?: boolean
}
export type UpdateListParams = {
  id: string
  actorId: string
  title?: string
  repliesPolicy?: ListRepliesPolicy
  exclusive?: boolean
}
export type GetListParams = { id: string; actorId: string }
export type GetListsParams = { actorId: string }
export type DeleteListParams = { id: string; actorId: string }
export type GetListAccountsParams = {
  listId: string
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type ListAccountsPage = {
  accounts: Mastodon.Account[]
  // Membership-row id of the oldest/newest row on this page, used to build the
  // Mastodon max_id/min_id pagination cursors. Null when the page is empty.
  nextMaxId: string | null
  prevMinId: string | null
}
export type GetListMembersParams = {
  listId: string
  actorId: string
  limit?: number
  maxId?: string | null
}
export type ListMember = {
  id: string
  targetActorId: string
}
export type AddListAccountsParams = {
  listId: string
  actorId: string
  targetActorIds: string[]
  // Admit only the owner and accounts the owner follows or has asked to
  // follow, checked in the same transaction as the insert (see
  // addListAccounts). Without it the members are inserted unconditionally.
  requireFollowOrRequest?: boolean
}
export type AddListAccountsResult = {
  // Accounts refused by requireFollowOrRequest: neither followed nor requested.
  // When any are refused, nothing is added.
  unrelatedActorIds: string[]
}
export type RemoveListAccountsParams = {
  listId: string
  actorId: string
  targetActorIds: string[]
}
export type GetListsWithAccountParams = {
  actorId: string
  targetActorId: string
}
export type GetListAccountCountsParams = {
  actorId: string
  listIds: string[]
}
export type GetListTimelineParams = {
  listId: string
  actorId: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
  sinceStatusId?: string | null
}
export type AddStatusToListTimelinesParams = {
  status: Status
}

export interface ListDatabase {
  createList(params: CreateListParams): Promise<List>
  updateList(params: UpdateListParams): Promise<List | null>
  getList(params: GetListParams): Promise<List | null>
  getLists(params: GetListsParams): Promise<List[]>
  deleteList(params: DeleteListParams): Promise<boolean>
  getListAccounts(params: GetListAccountsParams): Promise<ListAccountsPage>
  getListMembers(params: GetListMembersParams): Promise<ListMember[]>
  // Member counts keyed by list id for the supplied lists. Lists with no
  // members are present in the result with a count of 0.
  getListAccountCounts(
    params: GetListAccountCountsParams
  ): Promise<Record<string, number>>
  addListAccounts(params: AddListAccountsParams): Promise<AddListAccountsResult>
  removeListAccounts(params: RemoveListAccountsParams): Promise<void>
  getListsWithAccount(params: GetListsWithAccountParams): Promise<List[]>
  getListTimeline(params: GetListTimelineParams): Promise<Status[]>
  // Fan a newly created status into every list (in the `timelines` table) whose
  // membership includes the status author, except one whose owner is still
  // waiting on a follow request to them. Called from addStatusToTimelines.
  addStatusToListTimelines(
    params: AddStatusToListTimelinesParams
  ): Promise<void>
}
