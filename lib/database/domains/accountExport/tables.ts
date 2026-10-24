import { type RawBuilder, sql } from 'kysely'

import type { AccountExportTableName } from '@/lib/database/domains/accountExport/types'

// What the account export may read from each table. A column that is not
// listed is never selected: there is no `select *` here, so a new secret
// column on one of these tables cannot reach an archive without someone adding
// it to this list on purpose.
//
// Never list: private keys, password hashes, 2FA or passkey material, session
// tokens, OAuth clients/tokens, push subscription endpoints and keys, and the
// fitness provider credentials (clientId, clientSecret, webhook tokens, access
// and refresh tokens).

export type AccountExportTableSpec = {
  table: string
  columns: readonly string[]
  /** Sort key, also the keyset cursor. Must be unique per row within a scope. */
  key: readonly [string] | readonly [string, string]
  /** The condition tying a row to the exporting actor. */
  scope: (actorId: string) => RawBuilder<boolean>
  /** Rows soft-deleted with this column set are skipped. */
  softDeletedColumn?: string
  /** Text columns that hold JSON and are parsed into values. */
  json?: readonly string[]
  /** Boolean columns (0/1 on SQLite) normalised to true/false. */
  booleans?: readonly string[]
}

const byColumn = (column: string) => (actorId: string) =>
  sql<boolean>`${sql.ref(column)} = ${actorId}`

const FILTER_SCOPE = (actorId: string) =>
  sql<boolean>`${sql.ref('filterId')} in (select ${sql.ref('id')} from ${sql.table('filters')} where ${sql.ref('actorId')} = ${actorId})`

const LIST_SCOPE = byColumn('actorId')

const GEAR_SCOPE = (actorId: string) =>
  sql<boolean>`${sql.ref('gearId')} in (select ${sql.ref('id')} from ${sql.table('fitness_gears')} where ${sql.ref('actorId')} = ${actorId} and ${sql.ref('deletedAt')} is null)`

const COMPONENT_SCOPE = (actorId: string) =>
  sql<boolean>`${sql.ref('componentId')} in (select ${sql.ref('id')} from ${sql.table('fitness_gear_components')} where ${sql.ref('deletedAt')} is null and ${sql.ref('gearId')} in (select ${sql.ref('id')} from ${sql.table('fitness_gears')} where ${sql.ref('actorId')} = ${actorId} and ${sql.ref('deletedAt')} is null))`

export const ACCOUNT_EXPORT_TABLES: Record<
  AccountExportTableName,
  AccountExportTableSpec
> = {
  follows: {
    table: 'follows',
    columns: [
      'id',
      'targetActorId',
      'status',
      'reblogs',
      'notify',
      'languages',
      'createdAt',
      'updatedAt'
    ],
    key: ['id'],
    scope: byColumn('actorId'),
    json: ['languages'],
    booleans: ['reblogs', 'notify']
  },
  followers: {
    table: 'follows',
    columns: ['id', 'actorId', 'status', 'createdAt', 'updatedAt'],
    key: ['id'],
    scope: byColumn('targetActorId')
  },
  mutes: {
    table: 'mutes',
    columns: ['id', 'targetActorId', 'notifications', 'endsAt', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId'),
    booleans: ['notifications']
  },
  bookmarks: {
    table: 'bookmarks',
    columns: ['id', 'statusId', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  blocks: {
    table: 'blocks',
    columns: ['id', 'targetActorId', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  actor_domain_blocks: {
    table: 'actor_domain_blocks',
    columns: ['id', 'domain', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  account_notes: {
    table: 'account_notes',
    columns: ['id', 'targetActorId', 'comment', 'createdAt', 'updatedAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  endorsements: {
    table: 'endorsements',
    columns: ['id', 'targetActorId', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  featured_tags: {
    table: 'featured_tags',
    columns: ['id', 'name', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  followed_tags: {
    table: 'followed_tags',
    columns: ['id', 'name', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  lists: {
    table: 'lists',
    columns: [
      'id',
      'title',
      'repliesPolicy',
      'exclusive',
      'createdAt',
      'updatedAt'
    ],
    key: ['id'],
    scope: LIST_SCOPE,
    booleans: ['exclusive']
  },
  list_accounts: {
    table: 'list_accounts',
    columns: ['id', 'listId', 'targetActorId', 'createdAt'],
    key: ['id'],
    scope: byColumn('actorId')
  },
  filters: {
    table: 'filters',
    columns: [
      'id',
      'title',
      'context',
      'filterAction',
      'expiresAt',
      'createdAt',
      'updatedAt'
    ],
    key: ['id'],
    scope: byColumn('actorId'),
    json: ['context']
  },
  filter_keywords: {
    table: 'filter_keywords',
    columns: ['id', 'filterId', 'keyword', 'wholeWord', 'createdAt'],
    key: ['id'],
    scope: FILTER_SCOPE,
    booleans: ['wholeWord']
  },
  filter_statuses: {
    table: 'filter_statuses',
    columns: ['id', 'filterId', 'statusId', 'createdAt'],
    key: ['id'],
    scope: FILTER_SCOPE
  },
  status_pins: {
    table: 'status_pins',
    columns: ['statusId', 'createdAt'],
    key: ['statusId'],
    scope: byColumn('actorId')
  },
  status_reactions: {
    table: 'status_reactions',
    columns: ['statusId', 'name', 'url', 'createdAt'],
    key: ['statusId', 'name'],
    scope: byColumn('actorId')
  },
  poll_answers: {
    table: 'poll_answers',
    columns: ['answerId', 'statusId', 'choice', 'createdAt'],
    key: ['answerId'],
    scope: byColumn('actorId')
  },
  scheduled_statuses: {
    table: 'scheduled_statuses',
    columns: ['id', 'scheduledAt', 'params', 'createdAt', 'updatedAt'],
    key: ['id'],
    scope: byColumn('actorId'),
    json: ['params']
  },
  medias: {
    table: 'medias',
    columns: [
      'id',
      'original',
      'thumbnail',
      'description',
      'createdAt',
      'updatedAt',
      'originalMimeType',
      'originalBytes',
      'thumbnailBytes',
      'thumbnailMimeType',
      'originalMetaData',
      'thumbnailMetaData',
      'originalFileName',
      'focusX',
      'focusY',
      'blurhash',
      'subjectName',
      'subjectScientificName',
      'subjectCategory',
      'takenAt',
      'cameraGearId',
      'lensGearId',
      'exposure',
      'placeName',
      'placeLatitude',
      'placeLongitude',
      'placePrecision',
      'placeCountryCode',
      'placeNameSource',
      'inGallery',
      'subjectTaxonKey',
      'subjectTaxonPath',
      'subjectIucnCategory',
      'subjectSuggestions',
      'editRecipe',
      'editVersion',
      'editedAt',
      'galleryAddedAt'
    ],
    key: ['id'],
    scope: byColumn('actorId'),
    json: [
      'originalMetaData',
      'thumbnailMetaData',
      'exposure',
      'subjectSuggestions',
      'editRecipe'
    ],
    booleans: ['inGallery']
  },
  media_edit_files: {
    table: 'media_edit_files',
    columns: [
      'id',
      'mediaId',
      'slot',
      'path',
      'bytes',
      'mimeType',
      'createdAt'
    ],
    key: ['id'],
    scope: byColumn('actorId')
  },
  gallery_albums: {
    table: 'gallery_albums',
    columns: [
      'id',
      'title',
      'description',
      'coverMediaId',
      'visibility',
      'sortOrder',
      'createdAt',
      'updatedAt'
    ],
    key: ['id'],
    scope: byColumn('actorId')
  },
  gallery_album_items: {
    table: 'gallery_album_items',
    columns: ['albumId', 'mediaId', 'createdAt'],
    key: ['albumId', 'mediaId'],
    scope: byColumn('actorId')
  },
  gallery_gears: {
    table: 'gallery_gears',
    columns: [
      'id',
      'kind',
      'name',
      'brand',
      'model',
      'productUrl',
      'deviceKey',
      'retiredAt',
      'createdAt',
      'updatedAt'
    ],
    key: ['id'],
    scope: byColumn('actorId'),
    softDeletedColumn: 'deletedAt'
  },
  gallery_settings: {
    table: 'gallery_settings',
    columns: [
      'autoDescribe',
      'allowEmptyDescription',
      'subjectHashtags',
      'galleryDefault',
      'defaultPlacePrecision',
      'showGear',
      'mapPublic',
      'lifeListPublic',
      'hiddenLocations',
      'hideThreatenedPlaces',
      'subjectSuggestionMode',
      'subjectConfidenceThreshold',
      'photoEnhance',
      'createdAt',
      'updatedAt'
    ],
    key: ['actorId'],
    scope: byColumn('actorId'),
    json: ['hiddenLocations'],
    booleans: [
      'autoDescribe',
      'allowEmptyDescription',
      'subjectHashtags',
      'galleryDefault',
      'showGear',
      'mapPublic',
      'lifeListPublic',
      'hideThreatenedPlaces',
      'photoEnhance'
    ]
  },
  fitness_gears: {
    table: 'fitness_gears',
    columns: [
      'id',
      'kind',
      'name',
      'brand',
      'model',
      'bikeType',
      'weightKilograms',
      'defaultSports',
      'alertDistanceMeters',
      'lastAlertedDistanceMeters',
      'notes',
      'retiredAt',
      'createdAt',
      'updatedAt',
      'deviceKey',
      'productUrl'
    ],
    key: ['id'],
    scope: byColumn('actorId'),
    softDeletedColumn: 'deletedAt',
    json: ['defaultSports']
  },
  fitness_gear_components: {
    table: 'fitness_gear_components',
    columns: [
      'id',
      'gearId',
      'componentType',
      'brand',
      'model',
      'serviceDistanceMeters',
      'lastAlertedDistanceMeters',
      'createdAt',
      'updatedAt',
      'productUrl'
    ],
    key: ['id'],
    scope: GEAR_SCOPE,
    softDeletedColumn: 'deletedAt'
  },
  fitness_gear_component_periods: {
    table: 'fitness_gear_component_periods',
    columns: [
      'id',
      'componentId',
      'installSequence',
      'addedAt',
      'removedAt',
      'createdAt',
      'updatedAt'
    ],
    key: ['id'],
    scope: COMPONENT_SCOPE
  },
  // Provider rows (strava, wahoo, ...) hold the OAuth client id/secret, tokens
  // and webhook secrets; only the privacy zones and defaults are read.
  fitness_settings: {
    table: 'fitness_settings',
    columns: [
      'id',
      'serviceType',
      'privacyHomeLatitude',
      'privacyHomeLongitude',
      'privacyHideRadiusMeters',
      'privacyLocations',
      'defaultVisibility',
      'generateRouteDescription',
      'createdAt',
      'updatedAt'
    ],
    key: ['id'],
    scope: byColumn('actorId'),
    softDeletedColumn: 'deletedAt',
    json: ['privacyLocations'],
    booleans: ['generateRouteDescription']
  }
}
