// GENERATED FILE — do not edit by hand.
// Regenerate with scripts/maintenance/generateDatabaseTypes.ts whenever a
// migration changes the schema (see docs/setup.md, "Regenerating the Kysely DB
// types"). CI's PostgreSQL Schema Dump Sync job fails when this file drifts.
//
// The select side is what the Knex-backed Kysely driver returns on BOTH
// backends after normalisation (lib/database/kysely/normalize.ts); the
// insert/update side is what both backends accept:
// - Timestamp: read as epoch milliseconds, written as a Date (compare with
//   timestampValue() from lib/database/kysely/dialect.ts).
// - booleans, int8 and numeric read as boolean and number.
// - Json: read parsed, written as a JSON string.
// - Nullable<T> adds null; WithDefault<T> makes the column optional on insert
//   because both backends fill it in.
// - "Mismatch" marks a column whose type differs between
//   migrations/schema.sql and migrations/schema.sqlite.sql in a way that
//   changes what is read back; it is typed as either.
import type { ColumnType, InsertType, SelectType, UpdateType } from 'kysely'

export type Timestamp = ColumnType<number, Date, Date>
export type Json = ColumnType<unknown, string, string>
export type Nullable<T> = ColumnType<
  SelectType<T> | null,
  InsertType<T> | null,
  UpdateType<T> | null
>
export type WithDefault<T> = ColumnType<
  SelectType<T>,
  InsertType<T> | undefined,
  UpdateType<T>
>

export interface AccountNotes {
  actorHost: string
  actorId: string
  comment: WithDefault<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  targetActorHost: string
  targetActorId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface AccountProviders {
  accessToken: Nullable<string>
  accessTokenExpiresAt: Nullable<Timestamp>
  accountId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  idToken: Nullable<string>
  issuer: Nullable<string>
  password: Nullable<string>
  provider: Nullable<string>
  providerId: Nullable<string>
  refreshToken: Nullable<string>
  refreshTokenExpiresAt: Nullable<Timestamp>
  scope: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Accounts {
  approvedAt: Nullable<Timestamp>
  createdAt: WithDefault<Nullable<Timestamp>>
  defaultActorId: Nullable<string>
  disabledAt: Nullable<Timestamp>
  email: Nullable<string>
  emailChangeCode: Nullable<string>
  emailChangeCodeExpiresAt: Nullable<Timestamp>
  emailChangePending: Nullable<string>
  emailVerified: WithDefault<Nullable<boolean>>
  emailVerifiedAt: Nullable<Timestamp>
  iconUrl: Nullable<string>
  id: string
  image: Nullable<string>
  name: Nullable<string>
  passwordHash: Nullable<string>
  passwordResetCode: Nullable<string>
  passwordResetCodeExpiresAt: Nullable<Timestamp>
  role: Nullable<string>
  twoFactorEnabled: WithDefault<boolean>
  updatedAt: WithDefault<Nullable<Timestamp>>
  verificationCode: Nullable<string>
  verifiedAt: Nullable<Timestamp>
}

export interface ActorDomainBlocks {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  domain: string
  id: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Actors {
  accountId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  deletionScheduledAt: Nullable<Timestamp>
  deletionStatus: Nullable<string>
  domain: Nullable<string>
  id: Nullable<string>
  lastStatusAt: Nullable<Timestamp>
  name: Nullable<string>
  privateKey: Nullable<string>
  publicId: Nullable<string>
  publicKey: Nullable<string>
  sensitizedAt: Nullable<Timestamp>
  settings: Nullable<Json>
  silencedAt: Nullable<Timestamp>
  summary: Nullable<string>
  suspendedAt: Nullable<Timestamp>
  type: WithDefault<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  username: Nullable<string>
}

export interface AnnouncementReactions {
  actorId: string
  announcementId: string
  createdAt: Timestamp
  name: string
}

export interface AnnouncementReads {
  actorId: string
  announcementId: string
  createdAt: Timestamp
}

export interface Announcements {
  allDay: WithDefault<boolean>
  createdAt: Timestamp
  endsAt: Nullable<Timestamp>
  id: string
  published: WithDefault<boolean>
  publishedAt: Nullable<Timestamp>
  startsAt: Nullable<Timestamp>
  text: string
  updatedAt: Timestamp
}

export interface Attachments {
  actorId: Nullable<string>
  blurhash: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  focusX: Nullable<number>
  focusY: Nullable<number>
  height: Nullable<number>
  id: string
  /** Mismatch: PostgreSQL int4, SQLite varchar(255). */
  mediaId: Nullable<
    ColumnType<number | string, number | string, number | string>
  >
  mediaType: Nullable<string>
  name: Nullable<string>
  playbackType: Nullable<string>
  statusId: Nullable<string>
  thumbnailUrl: Nullable<string>
  type: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  url: Nullable<string>
  width: Nullable<number>
}

export interface AuthCodes {
  accountId: Nullable<string>
  actorId: Nullable<string>
  clientId: Nullable<string>
  code: string
  codeChallenge: Nullable<string>
  codeChallengeMethod: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  expiresAt: Nullable<Timestamp>
  redirectUri: Nullable<string>
  scopes: Nullable<Json>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Blocks {
  actorHost: string
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  targetActorHost: string
  targetActorId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  uri: string
}

export interface Bookmarks {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: WithDefault<number>
  sourceStatusId: Nullable<string>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Clients {
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  name: Nullable<string>
  redirectUris: Nullable<string>
  scopes: Nullable<string>
  secret: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  website: Nullable<string>
}

export interface CollectionMembers {
  collectionSeq: number
  createdAt: WithDefault<Nullable<Timestamp>>
  featureState: WithDefault<string>
  id: string
  seq: WithDefault<number>
  targetActorId: string
}

export interface CollectionTimeline {
  collectionSeq: number
  id: WithDefault<number>
  memberSeq: number
  sortKey: number
  statusId: string
}

export interface Collections {
  createdAt: WithDefault<Nullable<Timestamp>>
  description: Nullable<string>
  id: string
  language: Nullable<string>
  ownerActorId: string
  publicFeed: WithDefault<boolean>
  sensitive: WithDefault<boolean>
  seq: WithDefault<number>
  title: string
  topic: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  visibility: WithDefault<string>
}

export interface Counters {
  bucketHour: Nullable<Timestamp>
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  value: WithDefault<number>
}

export interface CustomEmojis {
  category: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  disabled: WithDefault<boolean>
  id: string
  shortcode: string
  staticUrl: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  url: string
  visibleInPicker: WithDefault<boolean>
}

export interface DeadLetterJobs {
  attempts: WithDefault<number>
  created_at: WithDefault<Nullable<Timestamp>>
  error_message: string
  error_stack: Nullable<string>
  id: string
  job_name: string
  payload: Json
  status: WithDefault<string>
  updated_at: WithDefault<Nullable<Timestamp>>
}

export interface DirectConversationMemberships {
  actorId: string
  conversationId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  hiddenAt: Nullable<Timestamp>
  id: WithDefault<number>
  lastStatusCreatedAt: Timestamp
  lastStatusId: string
  readAt: Nullable<Timestamp>
  unread: WithDefault<boolean>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface DirectConversationParticipants {
  actorId: string
  conversationId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface DirectConversationStatuses {
  conversationId: string
  createdAt: Timestamp
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface DirectConversations {
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  rootStatusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface DomainFederationRules {
  createdAt: WithDefault<Nullable<Timestamp>>
  domain: string
  id: string
  obfuscate: WithDefault<boolean>
  privateComment: Nullable<string>
  publicComment: Nullable<string>
  rejectMedia: WithDefault<boolean>
  rejectReports: WithDefault<boolean>
  severity: Nullable<string>
  source: Nullable<string>
  type: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Endorsements {
  actorHost: string
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: WithDefault<number>
  targetActorHost: string
  targetActorId: string
}

export interface FeaturedTags {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  name: string
  nameNormalized: string
}

export interface FederatedTimeline {
  createdAt: WithDefault<Nullable<Timestamp>>
  statusActorId: string
  statusId: string
}

export interface FilterKeywords {
  createdAt: WithDefault<Nullable<Timestamp>>
  filterId: string
  id: string
  keyword: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  wholeWord: WithDefault<boolean>
}

export interface FilterStatuses {
  createdAt: WithDefault<Nullable<Timestamp>>
  filterId: string
  id: string
  statusId: string
}

export interface Filters {
  actorId: string
  context: string
  createdAt: WithDefault<Nullable<Timestamp>>
  expiresAt: Nullable<number>
  filterAction: WithDefault<string>
  id: string
  title: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface FitnessFileRoutes {
  actorId: string
  createdAt: Timestamp
  fitnessFileId: string
  maxLat: Nullable<number>
  maxLng: Nullable<number>
  minLat: Nullable<number>
  minLng: Nullable<number>
  pointCount: WithDefault<number>
  points: Nullable<string>
  sourceVersion: WithDefault<number>
  updatedAt: Timestamp
}

export interface FitnessFiles {
  activityStartTime: Nullable<Timestamp>
  activityType: Nullable<string>
  actorId: string
  avgHeartRate: Nullable<number>
  avgPower: Nullable<number>
  bytes: number
  createdAt: WithDefault<Nullable<Timestamp>>
  deletedAt: Nullable<Timestamp>
  description: Nullable<string>
  deviceGearId: Nullable<string>
  deviceManufacturer: Nullable<string>
  deviceName: Nullable<string>
  elevationGainMeters: Nullable<number>
  elevationSeries: Nullable<string>
  fileName: string
  fileType: string
  gearId: Nullable<string>
  hasMapData: WithDefault<Nullable<boolean>>
  id: string
  importBatchId: Nullable<string>
  importError: Nullable<string>
  importStatus: Nullable<string>
  isPrimary: WithDefault<boolean>
  mapError: Nullable<string>
  mapImageEmailPath: Nullable<string>
  mapImagePath: Nullable<string>
  maxHeartRate: Nullable<number>
  maxPower: Nullable<number>
  mimeType: string
  movingTimeSeconds: Nullable<number>
  path: string
  processingStatus: WithDefault<Nullable<string>>
  sourceUrl: Nullable<string>
  statusId: Nullable<string>
  totalDistanceMeters: Nullable<number>
  totalDurationSeconds: Nullable<number>
  totalWorkKj: Nullable<number>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface FitnessGearComponentPeriods {
  addedAt: Nullable<Timestamp>
  componentId: string
  createdAt: Timestamp
  id: string
  installSequence: number
  removedAt: Nullable<Timestamp>
  updatedAt: Timestamp
}

export interface FitnessGearComponents {
  brand: Nullable<string>
  componentType: string
  createdAt: Timestamp
  deletedAt: Nullable<Timestamp>
  gearId: string
  id: string
  lastAlertedDistanceMeters: Nullable<number>
  model: Nullable<string>
  productUrl: Nullable<string>
  serviceDistanceMeters: Nullable<number>
  updatedAt: Timestamp
}

export interface FitnessGears {
  actorId: string
  alertDistanceMeters: Nullable<number>
  bikeType: Nullable<string>
  brand: Nullable<string>
  createdAt: Timestamp
  defaultSports: Nullable<string>
  deletedAt: Nullable<Timestamp>
  deviceKey: Nullable<string>
  id: string
  kind: string
  lastAlertedDistanceMeters: Nullable<number>
  model: Nullable<string>
  name: string
  notes: Nullable<string>
  productUrl: Nullable<string>
  retiredAt: Nullable<Timestamp>
  updatedAt: Timestamp
  weightKilograms: Nullable<number>
}

export interface FitnessImportLocks {
  createdAt: WithDefault<Nullable<Timestamp>>
  expiresAt: number
  lockKey: string
  token: string
}

export interface FitnessRouteHeatmapPyramids {
  activityCount: WithDefault<number>
  actorId: string
  claimSeq: WithDefault<number>
  completedAt: Nullable<Timestamp>
  createdAt: Timestamp
  cursorCreatedAt: Nullable<Timestamp>
  cursorId: Nullable<string>
  error: Nullable<string>
  id: string
  pointCount: WithDefault<number>
  scannedCount: WithDefault<number>
  status: WithDefault<string>
  tileCount: WithDefault<number>
  totalCount: WithDefault<number>
  updatedAt: Timestamp
  version: WithDefault<number>
}

export interface FitnessRouteHeatmapRegionNames {
  actorId: string
  createdAt: Timestamp
  name: string
  region: string
  updatedAt: Timestamp
}

export interface FitnessRouteHeatmapTiles {
  actorId: string
  createdAt: Timestamp
  pointCount: WithDefault<number>
  segments: Nullable<string>
  tileKey: string
  updatedAt: Timestamp
  version: WithDefault<number>
  x: number
  y: number
  z: number
}

export interface FitnessRouteHeatmaps {
  activityCount: WithDefault<number>
  activityType: Nullable<string>
  activityTypeKey: WithDefault<string>
  actorId: string
  bounds: Nullable<string>
  createdAt: Timestamp
  cursorOffset: WithDefault<number>
  deletedAt: Nullable<Timestamp>
  error: Nullable<string>
  id: string
  isPartial: WithDefault<boolean>
  periodEnd: Nullable<Timestamp>
  periodKey: string
  periodStart: Nullable<Timestamp>
  periodType: string
  pointCount: WithDefault<number>
  region: WithDefault<string>
  segments: Nullable<string>
  shareToken: Nullable<string>
  status: WithDefault<string>
  totalCount: WithDefault<number>
  updatedAt: Timestamp
}

export interface FitnessSettings {
  accessToken: Nullable<string>
  actorId: string
  clientId: Nullable<string>
  clientSecret: Nullable<string>
  connectionError: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  credentialVersion: WithDefault<number>
  defaultVisibility: Nullable<string>
  deletedAt: Nullable<Timestamp>
  generateRouteDescription: WithDefault<boolean>
  grantedScopes: Nullable<string>
  id: string
  lastImportAt: Nullable<Timestamp>
  lastWebhookAt: Nullable<Timestamp>
  oauthState: Nullable<string>
  oauthStateExpiry: Nullable<Timestamp>
  privacyHideRadiusMeters: Nullable<number>
  privacyHomeLatitude: Nullable<number>
  privacyHomeLongitude: Nullable<number>
  privacyLocations: WithDefault<Json>
  providerEnvironment: Nullable<string>
  providerUserId: Nullable<string>
  refreshToken: Nullable<string>
  serviceType: string
  tokenExpiresAt: Nullable<Timestamp>
  updatedAt: WithDefault<Nullable<Timestamp>>
  wahooWebhookToken: Nullable<string>
  wahooWebhookTokenHash: Nullable<string>
  webhookToken: Nullable<string>
}

export interface FollowedTags {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  name: string
  nameNormalized: string
}

export interface Follows {
  actorHost: Nullable<string>
  actorId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  inbox: Nullable<string>
  languages: Nullable<string>
  notify: WithDefault<boolean>
  reblogs: WithDefault<boolean>
  sharedInbox: Nullable<string>
  status: Nullable<string>
  targetActorHost: Nullable<string>
  targetActorId: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface GalleryAlbumItems {
  actorId: string
  albumId: string
  createdAt: Timestamp
  mediaId: number
}

export interface GalleryAlbums {
  actorId: string
  coverMediaId: Nullable<number>
  createdAt: Timestamp
  description: Nullable<string>
  id: string
  sortOrder: WithDefault<string>
  title: string
  updatedAt: Timestamp
  visibility: WithDefault<string>
}

export interface GalleryGears {
  actorId: string
  brand: Nullable<string>
  createdAt: Timestamp
  deletedAt: Nullable<Timestamp>
  deviceKey: Nullable<string>
  id: string
  kind: string
  model: Nullable<string>
  name: string
  productUrl: Nullable<string>
  retiredAt: Nullable<Timestamp>
  updatedAt: Timestamp
}

export interface GalleryLookupCache {
  expiresAt: Timestamp
  fetchedAt: Timestamp
  key: string
  kind: string
  outcome: string
  value: Nullable<string>
}

export interface GallerySettings {
  actorId: string
  allowEmptyDescription: WithDefault<boolean>
  autoDescribe: WithDefault<boolean>
  createdAt: Timestamp
  defaultPlacePrecision: WithDefault<string>
  galleryDefault: WithDefault<string>
  hiddenLocations: WithDefault<string>
  hideThreatenedPlaces: WithDefault<boolean>
  lifeListPublic: WithDefault<boolean>
  mapPublic: WithDefault<boolean>
  showGear: WithDefault<boolean>
  subjectConfidenceThreshold: WithDefault<number>
  subjectHashtags: WithDefault<boolean>
  subjectSuggestionMode: WithDefault<string>
  updatedAt: Timestamp
}

export interface IdempotencyKeys {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  key: string
  statusId: string
}

export interface InstanceRules {
  createdAt: Timestamp
  hint: WithDefault<string>
  id: string
  position: WithDefault<number>
  text: string
  updatedAt: Timestamp
}

export interface Jwks {
  alg: Nullable<string>
  createdAt: WithDefault<Timestamp>
  crv: Nullable<string>
  expiresAt: Nullable<Timestamp>
  id: string
  privateKey: string
  publicKey: string
}

export interface LegacyFitnessHeatmapMediaCleanup {
  actorId: string
  createdAt: Timestamp
  deletedAt: Nullable<Timestamp>
  error: Nullable<string>
  imagePath: string
}

export interface Likes {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface LinkPreviews {
  authorName: Nullable<string>
  authorUrl: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  description: Nullable<string>
  error: Nullable<string>
  fetchStatus: WithDefault<string>
  imageHeight: Nullable<number>
  imageUrl: Nullable<string>
  imageWidth: Nullable<number>
  publishedAt: Nullable<Timestamp>
  siteName: Nullable<string>
  title: Nullable<string>
  type: WithDefault<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  url: string
  urlHash: string
}

export interface ListAccounts {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  listId: string
  targetActorId: string
}

export interface Lists {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  exclusive: WithDefault<boolean>
  id: string
  repliesPolicy: WithDefault<string>
  title: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Markers {
  actorId: string
  id: string
  lastReadId: string
  timeline: string
  updatedAt: WithDefault<Timestamp>
  version: WithDefault<number>
}

export interface Medias {
  accountId: Nullable<string>
  actorId: Nullable<string>
  blurhash: Nullable<string>
  cameraGearId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  description: Nullable<string>
  exposure: Nullable<string>
  focusX: Nullable<number>
  focusY: Nullable<number>
  id: WithDefault<number>
  inGallery: WithDefault<boolean>
  lensGearId: Nullable<string>
  original: Nullable<string>
  originalBytes: Nullable<number>
  originalFileName: Nullable<string>
  originalMetaData: Nullable<Json>
  originalMimeType: Nullable<string>
  placeCountryCode: Nullable<string>
  placeLatitude: Nullable<number>
  placeLongitude: Nullable<number>
  placeLookupAt: Nullable<Timestamp>
  placeLookupStatus: Nullable<string>
  placeName: Nullable<string>
  placeNameSource: Nullable<string>
  placePrecision: Nullable<string>
  subjectCategory: Nullable<string>
  subjectIucnCategory: Nullable<string>
  subjectLookupAt: Nullable<Timestamp>
  subjectLookupStatus: Nullable<string>
  subjectName: Nullable<string>
  subjectScientificName: Nullable<string>
  subjectSuggestions: Nullable<string>
  subjectTaxonKey: Nullable<string>
  subjectTaxonPath: Nullable<string>
  takenAt: Nullable<Timestamp>
  thumbnail: Nullable<string>
  thumbnailBytes: Nullable<number>
  thumbnailMetaData: Nullable<Json>
  thumbnailMimeType: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface ModerationActions {
  action: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  moderatorAccountId: string
  moderatorActorId: Nullable<string>
  reportId: Nullable<string>
  targetActorId: string
  text: WithDefault<string>
}

export interface Mutes {
  actorHost: string
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  endsAt: Nullable<number>
  id: string
  notifications: WithDefault<boolean>
  targetActorHost: string
  targetActorId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Notifications {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  filtered: WithDefault<boolean>
  followId: Nullable<string>
  groupKey: Nullable<string>
  id: string
  isRead: WithDefault<Nullable<boolean>>
  reactionName: Nullable<string>
  readAt: Nullable<Timestamp>
  sourceActorId: string
  statusId: Nullable<string>
  type: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface OauthAccessToken {
  authorizationCodeId: Nullable<string>
  clientId: string
  confirmation: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  expiresAt: Timestamp
  id: string
  referenceId: Nullable<string>
  refreshId: Nullable<string>
  requestedUserInfoClaims: Nullable<string>
  resources: Nullable<string>
  revoked: Nullable<Timestamp>
  scopes: string
  sessionId: Nullable<string>
  token: string
  userId: Nullable<string>
}

export interface OauthClient {
  applicationType: Nullable<string>
  backchannelLogoutSessionRequired: Nullable<boolean>
  backchannelLogoutUri: Nullable<string>
  clientCredentialsScopes: Nullable<string>
  clientDiscoveryId: Nullable<string>
  clientId: string
  clientSecret: Nullable<string>
  contacts: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  disabled: WithDefault<Nullable<boolean>>
  dpopBoundAccessTokens: WithDefault<Nullable<boolean>>
  enableEndSession: Nullable<boolean>
  grantTypes: Nullable<string>
  icon: Nullable<string>
  id: string
  jwks: Nullable<string>
  jwksUri: Nullable<string>
  metadata: Nullable<string>
  name: Nullable<string>
  policy: Nullable<string>
  postLogoutRedirectUris: Nullable<string>
  public: Nullable<boolean>
  redirectUris: string
  referenceId: Nullable<string>
  requirePKCE: Nullable<boolean>
  responseTypes: Nullable<string>
  scopes: Nullable<string>
  skipConsent: Nullable<boolean>
  softwareId: Nullable<string>
  softwareStatement: Nullable<string>
  softwareVersion: Nullable<string>
  subjectType: Nullable<string>
  tokenEndpointAuthMethod: Nullable<string>
  tos: Nullable<string>
  type: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  uri: Nullable<string>
  userId: Nullable<string>
}

export interface OauthClientAssertion {
  expiresAt: Timestamp
  id: string
}

export interface OauthClientResource {
  clientId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  metadata: Nullable<string>
  resourceId: string
}

export interface OauthConsent {
  clientId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  referenceId: Nullable<string>
  requestedUserInfoClaims: Nullable<string>
  resources: Nullable<string>
  scopes: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  userId: Nullable<string>
}

export interface OauthRefreshToken {
  authTime: Nullable<Timestamp>
  authorizationCodeId: Nullable<string>
  clientId: string
  confirmation: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  expiresAt: Timestamp
  id: string
  referenceId: Nullable<string>
  requestedUserInfoClaims: Nullable<string>
  resources: Nullable<string>
  revoked: Nullable<Timestamp>
  rotatedAt: Nullable<Timestamp>
  rotationReplayExpiresAt: Nullable<Timestamp>
  rotationReplayResponse: Nullable<string>
  scopes: string
  sessionId: Nullable<string>
  token: string
  userId: string
}

export interface OauthResource {
  accessTokenTtl: Nullable<number>
  allowedScopes: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  customClaims: Nullable<string>
  disabled: Nullable<boolean>
  dpopBoundAccessTokensRequired: Nullable<boolean>
  id: string
  identifier: string
  metadata: Nullable<string>
  name: string
  policyVersion: Nullable<number>
  refreshTokenTtl: Nullable<number>
  signingAlgorithm: Nullable<string>
  signingKeyId: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Passkey {
  aaguid: Nullable<string>
  backedUp: WithDefault<boolean>
  counter: WithDefault<number>
  createdAt: WithDefault<Timestamp>
  credentialID: string
  deviceType: string
  id: string
  name: Nullable<string>
  publicKey: string
  rpID: Nullable<string>
  transports: Nullable<string>
  userId: string
}

export interface PollAnswers {
  actorId: string
  answerId: WithDefault<number>
  choice: number
  createdAt: WithDefault<Nullable<Timestamp>>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface PollChoices {
  choiceId: WithDefault<number>
  createdAt: WithDefault<Nullable<Timestamp>>
  statusId: Nullable<string>
  title: Nullable<string>
  totalVotes: WithDefault<number>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface PollVoters {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  id: WithDefault<number>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface PushSubscriptions {
  accessToken: Nullable<string>
  actorId: string
  alerts: Nullable<string>
  auth: string
  createdAt: WithDefault<Nullable<Timestamp>>
  endpoint: string
  id: string
  p256dh: string
  policy: WithDefault<string>
  standard: WithDefault<boolean>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface QueueJobs {
  attempts: WithDefault<number>
  claim_token: WithDefault<Nullable<string>>
  created_at: WithDefault<Nullable<Timestamp>>
  id: string
  last_error_message: Nullable<string>
  last_error_stack: Nullable<string>
  max_retries: WithDefault<number>
  name: string
  next_run_at: WithDefault<Timestamp>
  payload: Json
  status: WithDefault<string>
  updated_at: WithDefault<Nullable<Timestamp>>
}

export interface Recipients {
  actorId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  statusId: Nullable<string>
  type: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Relays {
  actorId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  followActivityId: Nullable<string>
  id: string
  inboxUrl: string
  lastError: Nullable<string>
  state: WithDefault<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Reports {
  actionTaken: WithDefault<boolean>
  actionTakenAt: Nullable<Timestamp>
  actionTakenByActorId: Nullable<string>
  actorId: string
  assignedActorId: Nullable<string>
  category: WithDefault<string>
  collectionIds: WithDefault<string>
  comment: WithDefault<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  forward: WithDefault<boolean>
  id: string
  ruleIds: WithDefault<string>
  statusIds: WithDefault<string>
  targetActorId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface ScheduledStatuses {
  actorId: string
  createdAt: Timestamp
  id: string
  params: string
  scheduledAt: Timestamp
  updatedAt: Timestamp
}

export interface SearchDocuments {
  actorId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  discoverable: Nullable<boolean>
  documentText: string
  entityCreatedAt: Nullable<Timestamp>
  entityId: string
  entityType: string
  id: string
  lastPostAt: Nullable<Timestamp>
  postCount: Nullable<number>
  updatedAt: WithDefault<Nullable<Timestamp>>
  visibility: Nullable<string>
}

/** Exists only on SQLite; guard every query on it with a SQLite check. */
export interface SearchDocumentsFts {
  documentText: Nullable<string>
  id: Nullable<string>
}

export interface ServerFilterKeywords {
  createdAt: WithDefault<Nullable<Timestamp>>
  filterId: string
  id: string
  keyword: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  wholeWord: WithDefault<boolean>
}

export interface ServerFilters {
  context: string
  createdAt: WithDefault<Nullable<Timestamp>>
  expiresAt: Nullable<number>
  filterAction: WithDefault<string>
  id: string
  title: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface ServerSettings {
  createdAt: Timestamp
  key: string
  updatedAt: Timestamp
  value: string
}

export interface Sessions {
  accountId: Nullable<string>
  actorId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  expireAt: Nullable<Timestamp>
  id: string
  ipAddress: Nullable<string>
  token: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  userAgent: Nullable<string>
}

export interface StatusDetectedLanguages {
  confidence: Nullable<number>
  createdAt: WithDefault<Nullable<Timestamp>>
  language: string
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface StatusHistory {
  createdAt: WithDefault<Nullable<Timestamp>>
  data: Nullable<Json>
  id: WithDefault<number>
  statusId: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface StatusLinkPreviews {
  createdAt: WithDefault<Nullable<Timestamp>>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  urlHash: string
}

export interface StatusMutes {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface StatusPins {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface StatusQuotes {
  authorizationUri: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  quoteRequestId: Nullable<string>
  quotedStatusId: string
  state: WithDefault<string>
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface StatusReactions {
  actorId: string
  createdAt: WithDefault<Nullable<Timestamp>>
  name: string
  statusId: string
  updatedAt: WithDefault<Nullable<Timestamp>>
  url: Nullable<string>
}

export interface Statuses {
  actorId: Nullable<string>
  applicationName: Nullable<string>
  applicationWebsite: Nullable<string>
  content: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  originalStatusId: Nullable<string>
  publicId: Nullable<string>
  reply: Nullable<string>
  replyHash: Nullable<string>
  type: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  url: Nullable<string>
  urlHash: Nullable<string>
}

export interface StravaArchiveImports {
  actorId: string
  archiveFitnessFileId: string
  archiveId: string
  batchId: string
  completedActivitiesCount: WithDefault<number>
  createdAt: WithDefault<Timestamp>
  failedActivitiesCount: WithDefault<number>
  firstFailureMessage: Nullable<string>
  id: string
  lastError: Nullable<string>
  mediaAttachmentRetry: WithDefault<number>
  nextActivityIndex: WithDefault<number>
  pendingMediaActivities: Nullable<string>
  resolvedAt: Nullable<Timestamp>
  status: string
  totalActivitiesCount: Nullable<number>
  updatedAt: WithDefault<Timestamp>
  visibility: string
}

export interface SuggestionDismissals {
  actorId: string
  createdAt: Timestamp
  targetActorId: string
}

export interface Tags {
  createdAt: WithDefault<Nullable<Timestamp>>
  id: string
  name: Nullable<string>
  nameNormalized: Nullable<string>
  statusId: Nullable<string>
  type: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
  value: Nullable<string>
}

export interface Timelines {
  actorId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  id: WithDefault<number>
  statusActorId: Nullable<string>
  statusId: Nullable<string>
  timeline: Nullable<string>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface Tokens {
  accessToken: string
  accessTokenExpiresAt: Nullable<Timestamp>
  accountId: Nullable<string>
  actorId: Nullable<string>
  clientId: Nullable<string>
  createdAt: WithDefault<Nullable<Timestamp>>
  refreshToken: Nullable<string>
  refreshTokenExpiresAt: Nullable<Timestamp>
  scopes: Nullable<Json>
  updatedAt: WithDefault<Nullable<Timestamp>>
}

export interface TranslationCache {
  content: string
  createdAt: WithDefault<Nullable<Timestamp>>
  detectedSourceLanguage: Nullable<string>
  provider: string
  sourceHash: string
  sourceLanguage: string
  targetLanguage: string
}

export interface TwoFactor {
  backupCodes: string
  failedVerificationCount: WithDefault<number>
  id: string
  lockedUntil: Nullable<Timestamp>
  secret: string
  userId: string
  verified: WithDefault<boolean>
}

export interface Verification {
  createdAt: WithDefault<Timestamp>
  expiresAt: Timestamp
  id: string
  identifier: string
  updatedAt: WithDefault<Timestamp>
  value: string
}

export interface WahooHistoryImports {
  actorId: string
  completed: WithDefault<number>
  createdAt: WithDefault<Timestamp>
  failed: WithDefault<number>
  fromDate: string
  id: string
  lastError: Nullable<string>
  nextPage: WithDefault<number>
  providerUserId: string
  scanComplete: WithDefault<boolean>
  status: WithDefault<string>
  toDate: string
  total: WithDefault<number>
  updatedAt: WithDefault<Timestamp>
}

export interface WahooImports {
  actorId: string
  attempts: WithDefault<number>
  createdAt: WithDefault<Timestamp>
  fitnessFileId: Nullable<string>
  hadStatus: WithDefault<boolean>
  historyImportId: Nullable<string>
  id: string
  lastError: Nullable<string>
  providerUserId: string
  status: WithDefault<string>
  statusId: Nullable<string>
  summaryId: Nullable<string>
  summaryUpdatedAt: Nullable<Timestamp>
  updatedAt: WithDefault<Timestamp>
  workoutId: string
}

export interface DB {
  account_notes: AccountNotes
  account_providers: AccountProviders
  accounts: Accounts
  actor_domain_blocks: ActorDomainBlocks
  actors: Actors
  announcement_reactions: AnnouncementReactions
  announcement_reads: AnnouncementReads
  announcements: Announcements
  attachments: Attachments
  auth_codes: AuthCodes
  blocks: Blocks
  bookmarks: Bookmarks
  clients: Clients
  collection_members: CollectionMembers
  collection_timeline: CollectionTimeline
  collections: Collections
  counters: Counters
  customEmojis: CustomEmojis
  dead_letter_jobs: DeadLetterJobs
  direct_conversation_memberships: DirectConversationMemberships
  direct_conversation_participants: DirectConversationParticipants
  direct_conversation_statuses: DirectConversationStatuses
  direct_conversations: DirectConversations
  domain_federation_rules: DomainFederationRules
  endorsements: Endorsements
  featured_tags: FeaturedTags
  federated_timeline: FederatedTimeline
  filter_keywords: FilterKeywords
  filter_statuses: FilterStatuses
  filters: Filters
  fitness_file_routes: FitnessFileRoutes
  fitness_files: FitnessFiles
  fitness_gear_component_periods: FitnessGearComponentPeriods
  fitness_gear_components: FitnessGearComponents
  fitness_gears: FitnessGears
  fitness_import_locks: FitnessImportLocks
  fitness_route_heatmap_pyramids: FitnessRouteHeatmapPyramids
  fitness_route_heatmap_region_names: FitnessRouteHeatmapRegionNames
  fitness_route_heatmap_tiles: FitnessRouteHeatmapTiles
  fitness_route_heatmaps: FitnessRouteHeatmaps
  fitness_settings: FitnessSettings
  followed_tags: FollowedTags
  follows: Follows
  gallery_album_items: GalleryAlbumItems
  gallery_albums: GalleryAlbums
  gallery_gears: GalleryGears
  gallery_lookup_cache: GalleryLookupCache
  gallery_settings: GallerySettings
  idempotency_keys: IdempotencyKeys
  instance_rules: InstanceRules
  jwks: Jwks
  legacy_fitness_heatmap_media_cleanup: LegacyFitnessHeatmapMediaCleanup
  likes: Likes
  link_previews: LinkPreviews
  list_accounts: ListAccounts
  lists: Lists
  markers: Markers
  medias: Medias
  moderation_actions: ModerationActions
  mutes: Mutes
  notifications: Notifications
  oauthAccessToken: OauthAccessToken
  oauthClient: OauthClient
  oauthClientAssertion: OauthClientAssertion
  oauthClientResource: OauthClientResource
  oauthConsent: OauthConsent
  oauthRefreshToken: OauthRefreshToken
  oauthResource: OauthResource
  passkey: Passkey
  poll_answers: PollAnswers
  poll_choices: PollChoices
  poll_voters: PollVoters
  push_subscriptions: PushSubscriptions
  queue_jobs: QueueJobs
  recipients: Recipients
  relays: Relays
  reports: Reports
  scheduled_statuses: ScheduledStatuses
  search_documents: SearchDocuments
  search_documents_fts: SearchDocumentsFts
  server_filter_keywords: ServerFilterKeywords
  server_filters: ServerFilters
  server_settings: ServerSettings
  sessions: Sessions
  status_detected_languages: StatusDetectedLanguages
  status_history: StatusHistory
  status_link_previews: StatusLinkPreviews
  status_mutes: StatusMutes
  status_pins: StatusPins
  status_quotes: StatusQuotes
  status_reactions: StatusReactions
  statuses: Statuses
  strava_archive_imports: StravaArchiveImports
  suggestion_dismissals: SuggestionDismissals
  tags: Tags
  timelines: Timelines
  tokens: Tokens
  translation_cache: TranslationCache
  twoFactor: TwoFactor
  verification: Verification
  wahoo_history_imports: WahooHistoryImports
  wahoo_imports: WahooImports
}
