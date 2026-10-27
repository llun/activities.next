import { z } from 'zod'

import { FITNESS_PRIVACY_RADIUS_OPTIONS } from '@/lib/services/fitness-files/privacy'
import { FITNESS_GEAR_KINDS } from '@/lib/services/fitness-files/sportTypes'
import {
  GALLERY_GEAR_KINDS,
  IUCN_CATEGORIES,
  MEDIA_PLACE_PRECISIONS,
  MEDIA_SUBJECT_CATEGORIES
} from '@/lib/types/database/gallery'
import {
  GALLERY_ALBUM_SORTS,
  GALLERY_ALBUM_VISIBILITIES
} from '@/lib/types/database/galleryAlbums'

const text = (max = 16_384) => z.string().max(max)
const uri = text(4_096)
const dateText = text(64)
const finiteNumber = z.number().finite()
const smallCount = <Schema extends z.ZodTypeAny>(schema: Schema, max = 200) =>
  z.array(schema).max(max)
const recipientList = z.union([uri, smallCount(uri, 1_000)])
const timestamp = z.union([finiteNumber, dateText])

const actorImageSchema = z
  .object({
    type: text(64).optional(),
    mediaType: text(256).nullish(),
    url: uri,
    name: text(1_024).nullish()
  })
  .strip()

const actorPropertySchema = z
  .object({
    type: z.literal('PropertyValue'),
    name: text(256),
    value: text(8_192)
  })
  .strip()

const actorEmojiSchema = z
  .object({
    type: z.literal('Emoji'),
    id: uri.optional(),
    name: text(256),
    updated: dateText.nullish(),
    icon: actorImageSchema
  })
  .strip()

export const mastodonActorSchema = z
  .object({
    id: uri,
    type: text(64).optional(),
    following: uri.optional(),
    followers: uri.optional(),
    inbox: uri.optional(),
    outbox: uri.optional(),
    featured: uri.optional(),
    featuredTags: uri.optional(),
    preferredUsername: text(256),
    webfinger: text(512).optional(),
    name: text(1_024).optional(),
    summary: text(8_192).optional(),
    url: uri.optional(),
    published: dateText.optional(),
    manuallyApprovesFollowers: z.boolean().optional(),
    discoverable: z.boolean().optional(),
    indexable: z.boolean().optional(),
    attributionDomains: smallCount(text(253), 100).optional(),
    alsoKnownAs: smallCount(uri, 100).optional(),
    movedTo: uri.optional(),
    publicKey: z
      .object({ id: uri, owner: uri, publicKeyPem: text(16_384) })
      .strip()
      .optional(),
    endpoints: z.object({ sharedInbox: uri.optional() }).strip().optional(),
    icon: actorImageSchema.optional(),
    image: actorImageSchema.optional(),
    tag: smallCount(actorEmojiSchema, 500).optional(),
    attachment: smallCount(actorPropertySchema, 100).optional(),
    likes: uri.optional(),
    bookmarks: uri.optional()
  })
  .strip()

const noteTagSchema = z
  .object({
    type: text(64),
    id: uri.optional(),
    href: uri.nullish(),
    name: text(1_024),
    updated: dateText.nullish(),
    icon: actorImageSchema.optional()
  })
  .strip()

const attachmentSchema = z
  .object({
    type: text(64).optional(),
    mediaType: text(256),
    url: uri,
    thumbnailUrl: uri.nullish(),
    blurhash: text(1_024).optional(),
    width: finiteNumber.optional(),
    height: finiteNumber.optional(),
    name: text(1_024).nullish(),
    focalPoint: z.tuple([finiteNumber, finiteNumber]).optional(),
    mediaId: text(256).nullish()
  })
  .strip()

const questionChoiceSchema = z
  .object({
    type: text(64).optional(),
    name: text(1_024),
    replies: z
      .object({ totalItems: finiteNumber.optional() })
      .strip()
      .optional()
  })
  .strip()

const noteUrlSchema = z.union([
  uri,
  z
    .object({
      type: text(64).optional(),
      href: uri.optional(),
      mediaType: text(256).optional()
    })
    .strip(),
  smallCount(
    z.union([
      uri,
      z
        .object({
          type: text(64).optional(),
          href: uri.optional(),
          mediaType: text(256).optional()
        })
        .strip()
    ]),
    20
  )
])

export const mastodonNoteSchema = z
  .object({
    id: uri,
    type: z.enum(['Note', 'Question']),
    attributedTo: uri.optional(),
    content: text(100_000),
    summary: text(8_192).nullish(),
    sensitive: z.boolean().optional(),
    published: dateText.nullish(),
    inReplyTo: z.union([uri, z.object({ id: uri }).strip()]).nullish(),
    to: recipientList.nullish(),
    cc: recipientList.nullish(),
    tag: z.union([noteTagSchema, smallCount(noteTagSchema, 500)]).optional(),
    attachment: z
      .union([attachmentSchema, smallCount(attachmentSchema, 40)])
      .optional(),
    url: noteUrlSchema.nullish(),
    quote: z.union([uri, z.object({ id: uri }).strip()]).nullish(),
    quoteUrl: uri.nullish(),
    quoteUri: uri.nullish(),
    _misskey_quote: uri.nullish(),
    endTime: dateText.nullish(),
    oneOf: smallCount(questionChoiceSchema, 20).optional(),
    anyOf: smallCount(questionChoiceSchema, 20).optional(),
    votersCount: finiteNumber.nullish(),
    closed: dateText.nullish()
  })
  .strip()

export const mastodonActivitySchema = z.discriminatedUnion('type', [
  z
    .object({
      id: uri,
      type: z.literal('Create'),
      actor: uri,
      published: dateText.nullish(),
      to: recipientList.nullish(),
      cc: recipientList.nullish(),
      object: mastodonNoteSchema
    })
    .strip(),
  z
    .object({
      id: uri,
      type: z.literal('Announce'),
      actor: uri,
      published: dateText.nullish(),
      to: recipientList.nullish(),
      cc: recipientList.nullish(),
      object: uri
    })
    .strip()
])

const orderedCollectionSchema = <Item extends z.ZodTypeAny>(item: Item) =>
  z
    .object({
      id: uri.optional(),
      type: z.enum(['OrderedCollection', 'OrderedCollectionPage']),
      totalItems: finiteNumber.optional(),
      orderedItems: smallCount(item, 200_000),
      partOf: uri.optional(),
      next: uri.optional(),
      prev: uri.optional()
    })
    .strip()

export const mastodonOutboxSchema = orderedCollectionSchema(
  mastodonActivitySchema
)
export const mastodonLikesSchema = orderedCollectionSchema(uri)
export const mastodonBookmarksSchema = orderedCollectionSchema(uri)

const fieldSchema = z
  .object({
    name: text(256),
    value: text(8_192),
    verifiedAt: finiteNumber.nullish()
  })
  .strip()
const booleanPreferences = z
  .object({
    follow_request: z.boolean().optional(),
    follow: z.boolean().optional(),
    like: z.boolean().optional(),
    mention: z.boolean().optional(),
    reply: z.boolean().optional(),
    reblog: z.boolean().optional(),
    quote: z.boolean().optional(),
    quoted_update: z.boolean().optional(),
    emoji_reaction: z.boolean().optional(),
    activity_import: z.boolean().optional(),
    gear_service_due: z.boolean().optional()
  })
  .strip()
const notificationPolicySchema = z
  .object({
    for_not_following: z.enum(['accept', 'filter', 'drop']).optional(),
    for_not_followers: z.enum(['accept', 'filter', 'drop']).optional(),
    for_new_accounts: z.enum(['accept', 'filter', 'drop']).optional(),
    for_private_mentions: z.enum(['accept', 'filter', 'drop']).optional(),
    for_limited_accounts: z.enum(['accept', 'filter', 'drop']).optional()
  })
  .strip()

export const ownProfileSettingsSchema = z
  .object({
    iconUrl: uri.optional(),
    headerImageUrl: uri.optional(),
    manuallyApprovesFollowers: z.boolean().optional(),
    fields: smallCount(fieldSchema, 4).optional(),
    tags: smallCount(
      z
        .object({ type: z.literal('emoji'), name: text(256), value: uri })
        .strip(),
      500
    ).optional(),
    bot: z.boolean().optional(),
    discoverable: z.boolean().optional(),
    indexable: z.boolean().optional(),
    hideCollections: z.boolean().optional(),
    attributionDomains: smallCount(text(253), 100).optional(),
    movedTo: uri.optional(),
    alsoKnownAs: smallCount(uri, 100).optional(),
    defaultPrivacy: z
      .enum(['public', 'unlisted', 'private', 'direct'])
      .optional(),
    defaultSensitive: z.boolean().optional(),
    defaultLanguage: text(64).optional(),
    defaultQuotePolicy: z.enum(['public', 'followers', 'nobody']).optional(),
    postLineLimit: z
      .union([z.literal(0), z.literal(5), z.literal(10)])
      .optional(),
    readingExpandMedia: z.enum(['default', 'show_all', 'hide_all']).optional(),
    readingExpandSpoilers: z.boolean().optional(),
    readingAutoplayGifs: z.boolean().optional(),
    emailNotifications: booleanPreferences.optional(),
    pushNotifications: booleanPreferences.optional(),
    notificationPolicy: notificationPolicySchema.optional(),
    avatarDescription: text(1_024).optional(),
    headerDescription: text(1_024).optional(),
    showMedia: z.boolean().optional(),
    showMediaReplies: z.boolean().optional(),
    showFeatured: z.boolean().optional()
  })
  .strip()

export const ownProfileSchema = z
  .object({
    id: uri,
    publicId: text(64).nullable(),
    handle: text(512),
    username: text(256),
    domain: text(253),
    name: text(1_024).nullable(),
    summary: text(8_192).nullable(),
    type: text(64).nullable(),
    isDefault: z.boolean(),
    createdAt: dateText.nullable(),
    settings: ownProfileSettingsSchema
  })
  .strip()

const statusTagSchema = z
  .object({
    id: text(256),
    statusId: uri,
    type: z.enum(['emoji', 'mention', 'hashtag']),
    name: text(1_024),
    value: uri,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strip()

const statusAttachmentSchema = attachmentSchema.extend({
  type: z.literal('Document'),
  mediaId: text(256).nullable()
})

const statusQuoteSchema = z
  .object({
    quotedStatusId: uri,
    quotedStatusUrl: uri.nullable().optional(),
    state: z.enum(['pending', 'accepted', 'rejected', 'revoked', 'deleted']),
    authorizationUri: uri.nullable().optional()
  })
  .strip()

const pollChoiceSchema = z
  .object({ title: text(1_024), totalVotes: finiteNumber })
  .strip()
const pollSchema = z
  .object({
    pollType: z.enum(['oneOf', 'anyOf']),
    endAt: dateText,
    hideTotals: z.boolean(),
    votersCount: finiteNumber.nullable(),
    choices: smallCount(pollChoiceSchema, 20)
  })
  .strip()

const editSchema = z
  .object({
    text: text(100_000),
    summary: text(8_192).nullable(),
    sensitive: z.boolean().nullable(),
    attachments: smallCount(statusAttachmentSchema, 40).nullable(),
    pollOptions: smallCount(text(1_024), 20).nullable(),
    supersededAt: dateText
  })
  .strip()

const statusBaseSchema = z.object({
  id: uri,
  publicId: text(64).nullable(),
  type: z.enum(['Note', 'Poll', 'Announce']),
  actorId: uri,
  visibility: z.enum(['public', 'unlisted', 'private', 'direct']),
  to: smallCount(uri, 1_000),
  cc: smallCount(uri, 1_000),
  createdAt: dateText,
  updatedAt: dateText
})

export const ownStatusRecordSchema = z.discriminatedUnion('type', [
  statusBaseSchema
    .extend({ type: z.literal('Announce'), originalStatusId: uri })
    .strip(),
  statusBaseSchema
    .extend({
      type: z.literal('Note'),
      url: uri.nullable(),
      inReplyTo: uri.nullable(),
      text: text(100_000),
      summary: text(8_192).nullable(),
      sensitive: z.boolean(),
      language: text(64).nullable(),
      applicationName: text(256).nullable(),
      applicationWebsite: uri.nullable(),
      pinned: z.boolean(),
      quote: statusQuoteSchema.nullable(),
      quoteApprovalPolicy: z.enum(['public', 'followers', 'nobody']),
      tags: smallCount(statusTagSchema, 2_000),
      attachments: smallCount(statusAttachmentSchema, 40),
      poll: z.null(),
      edits: smallCount(editSchema, 100)
    })
    .strip(),
  statusBaseSchema
    .extend({
      type: z.literal('Poll'),
      url: uri.nullable(),
      inReplyTo: uri.nullable(),
      text: text(100_000),
      summary: text(8_192).nullable(),
      sensitive: z.boolean(),
      language: text(64).nullable(),
      applicationName: text(256).nullable(),
      applicationWebsite: uri.nullable(),
      pinned: z.boolean(),
      quote: statusQuoteSchema.nullable(),
      quoteApprovalPolicy: z.enum(['public', 'followers', 'nobody']),
      tags: smallCount(statusTagSchema, 2_000),
      attachments: smallCount(statusAttachmentSchema, 40),
      poll: pollSchema,
      edits: smallCount(editSchema, 100)
    })
    .strip()
])

const mediaMetadataSchema = z
  .object({
    width: finiteNumber,
    height: finiteNumber,
    upload: z
      .object({
        state: z.enum(['pending', 'verified']),
        checksumSha1: text(128).optional(),
        checksumSha1Base64: text(128).optional(),
        contentType: text(256).optional(),
        size: finiteNumber.optional(),
        verifiedAt: finiteNumber.optional(),
        clientPath: text(4_096).optional()
      })
      .strip()
      .optional()
  })
  .strip()

const mediaExposureSchema = z
  .object({
    focalLengthMm: finiteNumber.optional(),
    aperture: finiteNumber.optional(),
    exposureTime: text(64).optional(),
    iso: finiteNumber.optional()
  })
  .strip()
const recipeUnit = finiteNumber.min(0).max(1)
const recipeMaskId = text(8).regex(/^[a-z0-9]{8}$/)
const recipeAdjustmentsSchema = z
  .object({
    exposure: finiteNumber.min(-5).max(5).optional(),
    contrast: finiteNumber.int().min(-100).max(100).optional(),
    highlights: finiteNumber.int().min(-100).max(100).optional(),
    shadows: finiteNumber.int().min(-100).max(100).optional(),
    whites: finiteNumber.int().min(-100).max(100).optional(),
    blacks: finiteNumber.int().min(-100).max(100).optional(),
    temperature: finiteNumber.int().min(-100).max(100).optional(),
    tint: finiteNumber.int().min(-100).max(100).optional(),
    vibrance: finiteNumber.int().min(-100).max(100).optional(),
    saturation: finiteNumber.int().min(-100).max(100).optional(),
    texture: finiteNumber.int().min(-100).max(100).optional(),
    clarity: finiteNumber.int().min(-100).max(100).optional(),
    vignette: finiteNumber.int().min(-100).max(100).optional()
  })
  .strip()
const recipeCropSchema = z
  .object({
    x: recipeUnit,
    y: recipeUnit,
    width: finiteNumber.gt(0).max(1),
    height: finiteNumber.gt(0).max(1)
  })
  .strip()
  .refine(
    (crop) =>
      crop.x + crop.width <= 1 + 1e-6 && crop.y + crop.height <= 1 + 1e-6
  )
const recipeGeometrySchema = z
  .object({
    rotate90: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    flipH: z.boolean(),
    straighten: finiteNumber.min(-45).max(45),
    crop: recipeCropSchema,
    aspect: z.enum(['original', 'free', '1:1', '4:5', '3:2', '16:9']),
    aspectPortrait: z.boolean().optional()
  })
  .strip()
const recipeMaskPointSchema = z
  .object({
    x: recipeUnit,
    y: recipeUnit,
    label: z.union([z.literal(0), z.literal(1)])
  })
  .strip()
const recipeMaskSchema = z
  .object({
    id: recipeMaskId,
    kind: z.enum(['subject', 'background', 'brush']),
    of: recipeMaskId.optional(),
    points: smallCount(recipeMaskPointSchema, 32),
    feather: finiteNumber.int().min(0).max(100),
    adjustments: recipeAdjustmentsSchema.omit({ vignette: true })
  })
  .strip()
const mediaEditRecipeSchema = z
  .object({
    v: z.literal(1),
    geometry: recipeGeometrySchema,
    adjustments: recipeAdjustmentsSchema,
    masks: smallCount(recipeMaskSchema, 4)
  })
  .strip()
const subjectSuggestionsSchema = z
  .object({
    model: text(256),
    generatedAt: dateText,
    checkedAgainst: z.literal('gbif').nullable(),
    candidates: smallCount(
      z
        .object({
          name: text(1_024),
          scientificName: text(1_024).nullable(),
          category: z.enum(MEDIA_SUBJECT_CATEGORIES),
          confidence: finiteNumber,
          taxonKey: text(128).nullable(),
          rank: text(128).nullable(),
          taxonPath: smallCount(text(1_024), 100)
        })
        .strip(),
      20
    ),
    group: z.enum(MEDIA_SUBJECT_CATEGORIES).nullable()
  })
  .strip()

const mediaEditFileSchema = z
  .object({
    id: text(256),
    slot: text(256),
    bytes: finiteNumber,
    mimeType: text(256),
    metaData: mediaMetadataSchema.nullable(),
    createdAt: dateText,
    archivePath: text(4_096)
  })
  .strip()

export const ownMediaLineSchema = z
  .object({
    id: finiteNumber,
    original: text(4_096).nullable(),
    thumbnail: text(4_096).nullable(),
    description: text(1_024).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    originalMimeType: text(256).nullable(),
    originalBytes: finiteNumber.nullable(),
    thumbnailBytes: finiteNumber.nullable(),
    thumbnailMimeType: text(256).nullable(),
    originalMetaData: mediaMetadataSchema.nullable(),
    thumbnailMetaData: mediaMetadataSchema.nullable(),
    originalFileName: text(512).nullable(),
    focusX: finiteNumber.nullable(),
    focusY: finiteNumber.nullable(),
    blurhash: text(1_024).nullable(),
    subjectName: text(1_024).nullable(),
    subjectScientificName: text(1_024).nullable(),
    subjectCategory: z.enum(MEDIA_SUBJECT_CATEGORIES).nullable(),
    takenAt: timestamp.nullable(),
    cameraGearId: text(256).nullable(),
    lensGearId: text(256).nullable(),
    exposure: mediaExposureSchema.nullable(),
    placeName: text(1_024).nullable(),
    placeLatitude: finiteNumber.nullable().optional(),
    placeLongitude: finiteNumber.nullable().optional(),
    placePrecision: z.enum(MEDIA_PLACE_PRECISIONS).nullable(),
    placeCountryCode: text(2).nullable(),
    placeNameSource: z.enum(['owner', 'geocoder']).nullable(),
    inGallery: z.boolean(),
    subjectTaxonKey: text(128).nullable(),
    subjectTaxonPath: smallCount(text(1_024), 100).nullable(),
    subjectIucnCategory: z.enum(IUCN_CATEGORIES).nullable(),
    subjectSuggestions: subjectSuggestionsSchema.nullable(),
    editRecipe: mediaEditRecipeSchema.nullable(),
    editVersion: finiteNumber,
    editedAt: timestamp.nullable(),
    galleryAddedAt: timestamp.nullable(),
    archivePath: text(4_096).nullable(),
    thumbnailArchivePath: text(4_096).nullable(),
    editFiles: smallCount(mediaEditFileSchema, 100)
  })
  .strip()

const albumItemSchema = z
  .object({ mediaId: finiteNumber, createdAt: timestamp })
  .strip()
export const ownAlbumSchema = z
  .object({
    id: text(256),
    title: text(256),
    description: text(8_192).nullable(),
    coverMediaId: finiteNumber.nullable(),
    visibility: z.enum(GALLERY_ALBUM_VISIBILITIES),
    sortOrder: z.enum(GALLERY_ALBUM_SORTS),
    createdAt: timestamp,
    updatedAt: timestamp,
    items: smallCount(albumItemSchema, 20_000)
  })
  .strip()

const gearBaseSchema = z.object({
  id: text(256),
  kind: text(64),
  name: text(256),
  brand: text(256).nullable(),
  model: text(256).nullable(),
  productUrl: uri.nullable(),
  deviceKey: text(512).nullable(),
  retiredAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp
})
export const ownGalleryGearSchema = gearBaseSchema
  .extend({
    kind: z.enum(GALLERY_GEAR_KINDS)
  })
  .strip()

const fitnessPeriodSchema = z
  .object({
    id: text(256),
    componentId: text(256),
    installSequence: finiteNumber,
    addedAt: timestamp.nullable(),
    removedAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strip()
const fitnessComponentSchema = z
  .object({
    id: text(256),
    gearId: text(256),
    componentType: text(64),
    brand: text(256).nullable(),
    model: text(256).nullable(),
    serviceDistanceMeters: finiteNumber.nullable(),
    lastAlertedDistanceMeters: finiteNumber.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    productUrl: uri.nullable(),
    periods: smallCount(fitnessPeriodSchema, 1_000)
  })
  .strip()
export const ownFitnessGearSchema = z
  .object({
    id: text(256),
    kind: z.enum(FITNESS_GEAR_KINDS),
    name: text(256),
    brand: text(256).nullable(),
    model: text(256).nullable(),
    bikeType: text(64).nullable(),
    weightKilograms: finiteNumber.nullable(),
    defaultSports: smallCount(text(64), 100).nullable(),
    alertDistanceMeters: finiteNumber.nullable(),
    lastAlertedDistanceMeters: finiteNumber.nullable(),
    notes: text(8_192).nullable(),
    retiredAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deviceKey: text(512).nullable(),
    productUrl: uri.nullable(),
    components: smallCount(fitnessComponentSchema, 100)
  })
  .strip()

export const ownFitnessFileLineSchema = z
  .object({
    id: text(256),
    statusId: uri.nullable(),
    fileName: text(512),
    fileType: text(32),
    mimeType: text(256),
    bytes: finiteNumber,
    description: text(1_024).nullable(),
    activityType: text(64).nullable(),
    activityStartTime: dateText.nullable(),
    totalDistanceMeters: finiteNumber.nullable(),
    totalDurationSeconds: finiteNumber.nullable(),
    movingTimeSeconds: finiteNumber.nullable(),
    elevationGainMeters: finiteNumber.nullable(),
    deviceManufacturer: text(256).nullable(),
    deviceName: text(256).nullable(),
    sourceUrl: uri.nullable(),
    gearId: text(256).nullable(),
    deviceGearId: text(256).nullable(),
    isPrimary: z.boolean().nullable(),
    importBatchId: text(256).nullable(),
    createdAt: dateText,
    archivePath: text(4_096)
  })
  .strip()

const privacyLocationSchema = z
  .object({
    latitude: finiteNumber,
    longitude: finiteNumber,
    hideRadiusMeters: z.custom<(typeof FITNESS_PRIVACY_RADIUS_OPTIONS)[number]>(
      (value) =>
        typeof value === 'number' &&
        FITNESS_PRIVACY_RADIUS_OPTIONS.some((option) => option === value)
    )
  })
  .strip()
const galleryHiddenLocationSchema = privacyLocationSchema
export const ownFitnessSettingsSchema = z
  .object({
    id: text(256),
    serviceType: text(64),
    privacyHomeLatitude: finiteNumber.nullable().optional(),
    privacyHomeLongitude: finiteNumber.nullable().optional(),
    privacyHideRadiusMeters: finiteNumber.nullable().optional(),
    privacyLocations: smallCount(privacyLocationSchema, 100),
    defaultVisibility: z
      .enum(['public', 'unlisted', 'private', 'direct'])
      .nullable(),
    generateRouteDescription: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strip()

export const ownGallerySettingsSchema = z
  .object({
    autoDescribe: z.boolean(),
    allowEmptyDescription: z.boolean(),
    subjectHashtags: z.boolean(),
    galleryDefault: z.unknown().optional(),
    defaultPlacePrecision: z.enum(MEDIA_PLACE_PRECISIONS),
    showGear: z.boolean(),
    mapPublic: z.boolean(),
    lifeListPublic: z.boolean(),
    hiddenLocations: smallCount(galleryHiddenLocationSchema, 100),
    hideThreatenedPlaces: z.boolean(),
    subjectSuggestionMode: z.enum(['model', 'off', 'classifier']),
    subjectConfidenceThreshold: finiteNumber,
    photoEnhance: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strip()

const scheduledParamsSchema = z
  .object({
    text: text(100_000).optional(),
    visibility: z.enum(['public', 'unlisted', 'private', 'direct']).optional(),
    sensitive: z.boolean().optional(),
    spoiler_text: text(8_192).optional(),
    language: text(64).optional(),
    media_ids: smallCount(text(256), 40).optional(),
    in_reply_to_id: text(256).optional(),
    poll: z
      .object({
        options: smallCount(text(1_024), 20),
        expires_in: finiteNumber,
        multiple: z.boolean().optional(),
        hide_totals: z.boolean().optional()
      })
      .strip()
      .optional()
  })
  .strip()
export const ownScheduledStatusSchema = z
  .object({
    id: text(256),
    scheduledAt: timestamp,
    params: scheduledParamsSchema,
    createdAt: timestamp,
    updatedAt: timestamp
  })
  .strip()

export const ownReactionSchema = z
  .object({
    kind: z.enum(['reaction', 'pollVote']),
    statusId: uri,
    name: text(256).optional(),
    url: uri.nullable().optional(),
    createdAt: timestamp,
    answerId: text(256).optional(),
    choice: finiteNumber.optional()
  })
  .strip()

export const ownMediaEditFileLineSchema = mediaEditFileSchema
export const archiveDocumentSchemas = {
  'actor.json': mastodonActorSchema,
  'outbox.json': mastodonOutboxSchema,
  'likes.json': mastodonLikesSchema,
  'bookmarks.json': mastodonBookmarksSchema,
  'profile.json': ownProfileSchema,
  'statuses.jsonl': ownStatusRecordSchema,
  'medias.jsonl': ownMediaLineSchema,
  'fitness/files.jsonl': ownFitnessFileLineSchema,
  'fitness/gears.json': smallCount(ownFitnessGearSchema, 20_000),
  'fitness/settings.json': smallCount(ownFitnessSettingsSchema, 100),
  'gallery/albums.json': smallCount(ownAlbumSchema, 20_000),
  'gallery/gears.json': smallCount(ownGalleryGearSchema, 20_000),
  'gallery/settings.json': ownGallerySettingsSchema.nullable(),
  'scheduled.json': smallCount(ownScheduledStatusSchema, 20_000),
  'reactions.jsonl': ownReactionSchema
} as const
