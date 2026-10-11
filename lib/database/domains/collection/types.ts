// Parameter and result types of the collection domain (collections, their
// members and the materialized collection feed). lib/types/database/operations.ts
// re-exports them, so existing imports keep working.
import type {
  Collection,
  CollectionFeatureState,
  CollectionVisibility
} from '@/lib/types/domain/collection'
import type { Status } from '@/lib/types/domain/status'
import type * as Mastodon from '@/lib/types/mastodon'

export type CreateCollectionParams = {
  actorId: string
  title: string
  description?: string | null
  topic?: string | null
  language?: string | null
  visibility?: CollectionVisibility
  sensitive?: boolean
  publicFeed?: boolean
}
export type UpdateCollectionParams = {
  id: string
  actorId: string
  title?: string
  description?: string | null
  topic?: string | null
  language?: string | null
  visibility?: CollectionVisibility
  sensitive?: boolean
  publicFeed?: boolean
}
export type GetCollectionParams = { id: string; actorId: string }
// Resolve a collection by id WITHOUT owner-scoping. Used by surfaces where the
// viewer is not the owner: the public collection page (which applies its own
// visibility/feed gate) and member-facing collection notifications (the member
// is legitimately in the collection, so may see its title). Callers are
// responsible for any visibility gating.
export type GetCollectionByIdParams = { id: string }
export type GetCollectionsParams = { actorId: string }
export type DeleteCollectionParams = { id: string; actorId: string }

export type AddCollectionMembersParams = {
  id: string
  actorId: string
  targetActorIds: string[]
}
export type RemoveCollectionMembersParams = {
  id: string
  actorId: string
  targetActorIds: string[]
}
// Member-facing consent action: the member (actorId) sets the state of THEIR
// OWN membership in a collection, regardless of who owns it. Used by the
// approve / revoke endpoints. Returns false when no such membership exists.
export type SetOwnCollectionMembershipStateParams = {
  collectionId: string
  actorId: string
  state: CollectionFeatureState
}
export type GetCollectionMembersParams = {
  id: string
  actorId: string
  // 'owner' returns all members; 'public' returns only approved members.
  projection?: 'owner' | 'public'
  limit?: number
  maxId?: string | null
  sinceId?: string | null
}
export type CollectionMembersPage = {
  accounts: Mastodon.Account[]
  nextMaxId: string | null
  prevMinId: string | null
}
export type GetCollectionMemberCountsParams = {
  actorId: string
  collectionIds: string[]
  // Count only approved members (the public size) when true; otherwise all.
  approvedOnly?: boolean
}
export type GetCollectionTimelineParams = {
  id: string
  // The owner's actor id. This read is ALWAYS owner-scoped (the collection is
  // resolved by id + this owner), for both projections. 'public' here is the
  // owner previewing their own public projection (approved members, public-only
  // posts); truly unauthenticated public reads go through
  // getPublicCollectionTimeline instead.
  actorId: string
  projection?: 'owner' | 'public'
  // Hydration-only viewer; see GetPublicCollectionTimelineParams. Defaults to
  // the owner, so the owner's own public preview still shows their state.
  currentActorId?: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
}
export type GetPublicCollectionTimelineParams = {
  id: string
  // The signed-in reader, for hydration only. `projection` decides WHICH
  // statuses this feed contains; this decides whose like/bookmark/reaction
  // state they carry. A public feed rendered for a signed-in viewer still shows
  // interactive controls, so those controls must reflect that viewer.
  currentActorId?: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
}
export type AddStatusToCollectionTimelinesParams = {
  status: Status
}
export type GetApprovedCollectionMembersParams = {
  id: string
  actorId: string
}
// A featured member's ActivityPub id and actor type (Person/Service/Group/…),
// resolved from the local `actors` table (defaulting to 'Person' when unknown).
export type ApprovedCollectionMember = {
  id: string
  type: string
}
// A raw collection membership row (an "item" in the Mastodon 4.6 vocabulary):
// the stable item id plus the member, consent state, and add time. Exposed as
// stored — mapping featureState to the spec `state` vocabulary happens in the
// serializer (lib/services/collections/serializers.ts).
export type CollectionItemRow = {
  id: string
  targetActorId: string
  featureState: CollectionFeatureState
  createdAt: number
}
export type GetCollectionItemsParams = {
  // Collection ids (public UUIDs), not seqs. Non-owner-scoped: callers gate
  // visibility BEFORE asking for items.
  collectionIds: string[]
  // Only approved (publicly consented) items when true — the public projection.
  approvedOnly?: boolean
  // Return at most this many items (oldest-first) per collection. Omit to load
  // every member; public callers that only embed a preview must set it so the
  // read does not scale with the collection's size.
  limitPerCollection?: number
}
export type GetCollectionItemParams = { collectionId: string; itemId: string }
export type GetCollectionItemByAccountParams = {
  collectionId: string
  targetActorId: string
}
// Owner-scoped removal addressed by the CollectionItem id (Mastodon 4.6
// `DELETE /collections/:id/items/:item_id`).
export type RemoveCollectionItemByIdParams = {
  id: string
  actorId: string
  itemId: string
}
export type GetAccountCollectionsParams = {
  ownerActorId: string
  // Only discoverable (visibility 'public') collections when true — what
  // strangers and anonymous viewers may list.
  publicOnly?: boolean
  limit?: number
  offset?: number
}
export type GetCollectionsFeaturingAccountParams = {
  targetActorId: string
  // The authenticated caller: sees their own collections featuring the target
  // regardless of state/visibility, and other owners' collections only when
  // public with an approved (consented) membership.
  viewerActorId: string
  limit?: number
  offset?: number
}
// Item counts keyed by collection id, non-owner-scoped (callers gate
// visibility). Collections with no matching items are present with 0.
export type CountCollectionItemsParams = {
  collectionIds: string[]
  approvedOnly?: boolean
}

export interface CollectionDatabase {
  createCollection(params: CreateCollectionParams): Promise<Collection>
  updateCollection(params: UpdateCollectionParams): Promise<Collection | null>
  getCollection(params: GetCollectionParams): Promise<Collection | null>
  // Non-owner-scoped lookup by id (see GetCollectionByIdParams).
  getCollectionById(params: GetCollectionByIdParams): Promise<Collection | null>
  getCollections(params: GetCollectionsParams): Promise<Collection[]>
  deleteCollection(params: DeleteCollectionParams): Promise<boolean>
  // Member counts keyed by collection id. Collections with no (matching) members
  // are present in the result with a count of 0.
  getCollectionMemberCounts(
    params: GetCollectionMemberCountsParams
  ): Promise<Record<string, number>>
  // Adds members (idempotently) and returns the actor ids that were NEWLY added
  // (not already members), so callers can notify only the newly-added members.
  addCollectionMembers(params: AddCollectionMembersParams): Promise<string[]>
  removeCollectionMembers(params: RemoveCollectionMembersParams): Promise<void>
  // Member-facing approve/revoke of the caller's own membership. Returns true
  // when a membership row was updated, false when none matched.
  setOwnCollectionMembershipState(
    params: SetOwnCollectionMembershipStateParams
  ): Promise<boolean>
  getCollectionMembers(
    params: GetCollectionMembersParams
  ): Promise<CollectionMembersPage>
  // Approved members (id + actor type), oldest-first, owner-scoped. Used to
  // build the FEP-7aa9 FeaturedCollection ActivityPub representation, where each
  // FeaturedItem carries the member's actual `featuredObjectType`.
  getApprovedCollectionMembers(
    params: GetApprovedCollectionMembersParams
  ): Promise<ApprovedCollectionMember[]>
  // Membership rows ("items") grouped by collection id, oldest-first.
  getCollectionItems(
    params: GetCollectionItemsParams
  ): Promise<Record<string, CollectionItemRow[]>>
  getCollectionItem(
    params: GetCollectionItemParams
  ): Promise<CollectionItemRow | null>
  getCollectionItemByAccount(
    params: GetCollectionItemByAccountParams
  ): Promise<CollectionItemRow | null>
  countCollectionItems(
    params: CountCollectionItemsParams
  ): Promise<Record<string, number>>
  // An account's collections for a viewer projection (publicOnly for
  // strangers), createdAt-ascending with limit/offset paging.
  getAccountCollections(
    params: GetAccountCollectionsParams
  ): Promise<Collection[]>
  // ALL collections featuring an account that the viewer may see: the
  // viewer's own plus other owners' public collections with an approved
  // membership.
  getCollectionsFeaturingAccount(
    params: GetCollectionsFeaturingAccountParams
  ): Promise<Collection[]>
  // Returns false when the collection is not owned by the actor or the item
  // does not exist.
  removeCollectionItemById(
    params: RemoveCollectionItemByIdParams
  ): Promise<boolean>
  getCollectionTimeline(params: GetCollectionTimelineParams): Promise<Status[]>
  // Read a collection's PUBLIC feed by id without owner scoping. Returns null
  // when the collection does not exist, is private, or has the feed disabled
  // (so the route can return 404); otherwise the approved/public-only statuses.
  getPublicCollectionTimeline(
    params: GetPublicCollectionTimelineParams
  ): Promise<Status[] | null>
  // Fan a newly created status into every collection whose membership includes
  // the status author (capped per collection). Called from addStatusToTimelines.
  addStatusToCollectionTimelines(
    params: AddStatusToCollectionTimelinesParams
  ): Promise<void>
}
