-- FROZEN baseline schema (PostgreSQL), loaded by the first Kysely migration
-- (migrations/20261014000000_baseline.ts) into an empty database. Derived once
-- from migrations/schema.sql as the last Knex migration (in migrations/legacy/)
-- left it: the knex_migrations / knex_migrations_lock tables and sequences, the
-- pg_dump session preamble (SET ... / set_config('search_path' ...), which
-- includes the PostgreSQL 17-only transaction_timeout) and every `public.`
-- qualifier removed, so it loads on PostgreSQL 14+ into the connection's
-- search_path. Never edit it: schema changes are new migrations.

CREATE TABLE account_notes (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "actorHost" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "targetActorHost" character varying(255) NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_providers (
    id character varying(255) NOT NULL,
    "accountId" character varying(255),
    provider character varying(255),
    "providerId" character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    password text,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    scope text,
    issuer character varying(255)
);

CREATE TABLE accounts (
    id character varying(255) NOT NULL,
    email character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "passwordHash" character varying(255),
    "verificationCode" character varying(255),
    "verifiedAt" timestamp with time zone,
    "defaultActorId" character varying(255),
    "emailChangePending" character varying(255),
    "emailChangeCode" character varying(255),
    "emailChangeCodeExpiresAt" timestamp with time zone,
    "emailVerifiedAt" timestamp with time zone,
    "passwordResetCode" character varying(255),
    "passwordResetCodeExpiresAt" timestamp with time zone,
    name character varying(255),
    image text,
    "emailVerified" boolean DEFAULT false,
    "iconUrl" character varying(255),
    role text,
    "twoFactorEnabled" boolean DEFAULT false NOT NULL,
    "disabledAt" timestamp with time zone,
    "approvedAt" timestamp with time zone
);

CREATE TABLE actor_domain_blocks (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    domain character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE actors (
    id character varying(255),
    username character varying(255),
    "accountId" character varying(255),
    name character varying(255),
    summary text,
    "publicKey" text,
    "privateKey" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    settings jsonb,
    domain character varying(255),
    "deletionStatus" character varying(255),
    "deletionScheduledAt" timestamp with time zone,
    type character varying(255) DEFAULT 'Person'::character varying NOT NULL,
    "lastStatusAt" timestamp with time zone,
    "suspendedAt" timestamp with time zone,
    "silencedAt" timestamp with time zone,
    "sensitizedAt" timestamp with time zone,
    "publicId" character varying(36)
);

CREATE TABLE announcement_reactions (
    "announcementId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE announcement_reads (
    "announcementId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE announcements (
    id character varying(255) NOT NULL,
    text text NOT NULL,
    published boolean DEFAULT false NOT NULL,
    "allDay" boolean DEFAULT false NOT NULL,
    "startsAt" timestamp with time zone,
    "endsAt" timestamp with time zone,
    "publishedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE attachments (
    id character varying(255) NOT NULL,
    "statusId" character varying(255),
    url character varying(255),
    "mediaType" character varying(255),
    type character varying(255),
    width integer,
    height integer,
    name text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "actorId" character varying(255),
    "mediaId" integer,
    blurhash character varying(255),
    "focusX" double precision,
    "focusY" double precision,
    "thumbnailUrl" character varying(255),
    "playbackType" character varying(32)
);

CREATE TABLE auth_codes (
    code character varying(255) NOT NULL,
    "redirectUri" character varying(255),
    "codeChallenge" character varying(255),
    "codeChallengeMethod" character varying(255),
    "clientId" character varying(255),
    "actorId" character varying(255),
    "accountId" character varying(255),
    scopes jsonb,
    "expiresAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE blocks (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "actorHost" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "targetActorHost" character varying(255) NOT NULL,
    uri character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bookmarks (
    id bigint NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "sourceStatusId" character varying(255)
);

CREATE SEQUENCE bookmarks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE bookmarks_id_seq OWNED BY bookmarks.id;

CREATE TABLE clients (
    id character varying(255) NOT NULL,
    name character varying(255),
    secret character varying(255),
    "redirectUris" text,
    scopes text,
    website character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE collection_members (
    seq bigint NOT NULL,
    id character varying(255) NOT NULL,
    "collectionSeq" bigint NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "featureState" character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE collection_members_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE collection_members_seq_seq OWNED BY collection_members.seq;

CREATE TABLE collection_timeline (
    id bigint NOT NULL,
    "collectionSeq" bigint NOT NULL,
    "memberSeq" bigint NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "sortKey" bigint NOT NULL
);

CREATE SEQUENCE collection_timeline_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE collection_timeline_id_seq OWNED BY collection_timeline.id;

CREATE TABLE collections (
    seq bigint NOT NULL,
    id character varying(255) NOT NULL,
    "ownerActorId" character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    topic character varying(255),
    language character varying(10),
    visibility character varying(16) DEFAULT 'public'::character varying NOT NULL,
    "publicFeed" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    sensitive boolean DEFAULT false NOT NULL
);

CREATE SEQUENCE collections_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE collections_seq_seq OWNED BY collections.seq;

CREATE TABLE counters (
    id text NOT NULL,
    value bigint DEFAULT '0'::bigint NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "bucketHour" timestamp with time zone
);

CREATE TABLE "customEmojis" (
    id character varying(255) NOT NULL,
    shortcode character varying(255) NOT NULL,
    url text NOT NULL,
    "staticUrl" text NOT NULL,
    category character varying(255),
    "visibleInPicker" boolean DEFAULT true NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE dead_letter_jobs (
    id character varying(255) NOT NULL,
    job_name character varying(255) NOT NULL,
    payload jsonb NOT NULL,
    error_message text NOT NULL,
    error_stack text,
    attempts integer DEFAULT 1 NOT NULL,
    status character varying(32) DEFAULT 'failed'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE direct_conversation_memberships (
    id bigint NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "conversationId" character varying(255) NOT NULL,
    "lastStatusId" character varying(255) NOT NULL,
    "lastStatusCreatedAt" timestamp with time zone NOT NULL,
    unread boolean DEFAULT false NOT NULL,
    "readAt" timestamp with time zone,
    "hiddenAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE direct_conversation_memberships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE direct_conversation_memberships_id_seq OWNED BY direct_conversation_memberships.id;

CREATE TABLE direct_conversation_participants (
    id character varying(255) NOT NULL,
    "conversationId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE direct_conversation_statuses (
    "conversationId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE direct_conversations (
    id character varying(255) NOT NULL,
    "rootStatusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE domain_federation_rules (
    id character varying(255) NOT NULL,
    domain character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    severity character varying(255),
    "rejectMedia" boolean DEFAULT false NOT NULL,
    "rejectReports" boolean DEFAULT false NOT NULL,
    "privateComment" text,
    "publicComment" text,
    obfuscate boolean DEFAULT false NOT NULL,
    source character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE endorsements (
    id integer NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "actorHost" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "targetActorHost" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE endorsements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE endorsements_id_seq OWNED BY endorsements.id;

CREATE TABLE featured_tags (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "nameNormalized" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE federated_timeline (
    "statusId" character varying(255) NOT NULL,
    "statusActorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE filter_keywords (
    id character varying(255) NOT NULL,
    "filterId" character varying(255) NOT NULL,
    keyword text NOT NULL,
    "wholeWord" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE filter_statuses (
    id character varying(255) NOT NULL,
    "filterId" character varying(255) NOT NULL,
    "statusId" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE filters (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    context text NOT NULL,
    "filterAction" character varying(255) DEFAULT 'warn'::character varying NOT NULL,
    "expiresAt" bigint,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fitness_file_routes (
    "fitnessFileId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    points text,
    "pointCount" integer DEFAULT 0 NOT NULL,
    "minLat" double precision,
    "maxLat" double precision,
    "minLng" double precision,
    "maxLng" double precision,
    "sourceVersion" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE fitness_files (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "statusId" character varying(255),
    path character varying(255) NOT NULL,
    "fileName" character varying(255) NOT NULL,
    "fileType" character varying(255) NOT NULL,
    "mimeType" character varying(255) NOT NULL,
    bytes bigint NOT NULL,
    description text,
    "hasMapData" boolean DEFAULT false,
    "mapImagePath" character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" timestamp with time zone,
    "processingStatus" character varying(255) DEFAULT 'pending'::character varying,
    "totalDistanceMeters" real,
    "totalDurationSeconds" real,
    "elevationGainMeters" real,
    "activityType" character varying(255),
    "activityStartTime" timestamp with time zone,
    "isPrimary" boolean DEFAULT true NOT NULL,
    "importBatchId" character varying(255),
    "importStatus" character varying(255),
    "importError" text,
    "deviceManufacturer" character varying(255),
    "deviceName" character varying(255),
    "sourceUrl" text,
    "movingTimeSeconds" real,
    "mapImageEmailPath" character varying(255),
    "mapError" text,
    "gearId" character varying(255),
    "deviceGearId" character varying(255),
    "avgPower" integer,
    "maxPower" integer,
    "avgHeartRate" integer,
    "maxHeartRate" integer,
    "totalWorkKj" integer,
    "elevationSeries" text
);

CREATE TABLE fitness_gear_component_periods (
    id character varying(255) NOT NULL,
    "componentId" character varying(255) NOT NULL,
    "installSequence" integer NOT NULL,
    "addedAt" timestamp with time zone,
    "removedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE fitness_gear_components (
    id character varying(255) NOT NULL,
    "gearId" character varying(255) NOT NULL,
    "componentType" character varying(255) NOT NULL,
    brand character varying(255),
    model character varying(255),
    "serviceDistanceMeters" real,
    "lastAlertedDistanceMeters" real,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "deletedAt" timestamp with time zone,
    "productUrl" character varying(255)
);

CREATE TABLE fitness_gears (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    kind character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    brand character varying(255),
    model character varying(255),
    "bikeType" character varying(255),
    "weightKilograms" real,
    "defaultSports" text,
    "alertDistanceMeters" real,
    "lastAlertedDistanceMeters" real,
    notes text,
    "retiredAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "deletedAt" timestamp with time zone,
    "deviceKey" character varying(255),
    "productUrl" character varying(255)
);

CREATE TABLE fitness_import_locks (
    "lockKey" character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    "expiresAt" bigint NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fitness_route_heatmap_pyramids (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    status character varying(255) DEFAULT 'idle'::character varying NOT NULL,
    error text,
    version integer DEFAULT 0 NOT NULL,
    "claimSeq" integer DEFAULT 0 NOT NULL,
    "totalCount" integer DEFAULT 0 NOT NULL,
    "scannedCount" integer DEFAULT 0 NOT NULL,
    "activityCount" integer DEFAULT 0 NOT NULL,
    "tileCount" integer DEFAULT 0 NOT NULL,
    "pointCount" integer DEFAULT 0 NOT NULL,
    "cursorCreatedAt" timestamp with time zone,
    "cursorId" character varying(255),
    "completedAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE fitness_route_heatmap_region_names (
    "actorId" character varying(255) NOT NULL,
    region character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE fitness_route_heatmap_tiles (
    "actorId" character varying(255) NOT NULL,
    "tileKey" character varying(255) NOT NULL,
    z integer NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    version integer DEFAULT 0 NOT NULL,
    segments text,
    "pointCount" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE fitness_route_heatmaps (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "activityType" character varying(255),
    "activityTypeKey" character varying(255) DEFAULT ''::character varying NOT NULL,
    "periodType" character varying(255) NOT NULL,
    "periodKey" character varying(255) NOT NULL,
    region character varying(255) DEFAULT ''::character varying NOT NULL,
    "periodStart" timestamp with time zone,
    "periodEnd" timestamp with time zone,
    bounds text,
    segments text,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    error text,
    "activityCount" integer DEFAULT 0 NOT NULL,
    "pointCount" integer DEFAULT 0 NOT NULL,
    "cursorOffset" integer DEFAULT 0 NOT NULL,
    "isPartial" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "deletedAt" timestamp with time zone,
    "totalCount" integer DEFAULT 0 NOT NULL,
    "shareToken" character varying(255)
);

CREATE TABLE fitness_settings (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "serviceType" character varying(255) NOT NULL,
    "clientId" character varying(255),
    "clientSecret" text,
    "webhookToken" character varying(255),
    "accessToken" text,
    "refreshToken" text,
    "tokenExpiresAt" timestamp with time zone,
    "oauthState" character varying(255),
    "oauthStateExpiry" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" timestamp with time zone,
    "privacyHomeLatitude" double precision,
    "privacyHomeLongitude" double precision,
    "privacyHideRadiusMeters" integer,
    "privacyLocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "defaultVisibility" character varying(255),
    "providerUserId" character varying(255),
    "providerEnvironment" character varying(255),
    "grantedScopes" character varying(255),
    "wahooWebhookToken" text,
    "wahooWebhookTokenHash" character varying(255),
    "lastWebhookAt" timestamp with time zone,
    "lastImportAt" timestamp with time zone,
    "connectionError" text,
    "credentialVersion" integer DEFAULT 0 NOT NULL,
    "generateRouteDescription" boolean DEFAULT false NOT NULL
);

CREATE TABLE followed_tags (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "nameNormalized" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE follows (
    id character varying(255) NOT NULL,
    "actorId" character varying(255),
    "actorHost" character varying(255),
    "targetActorId" character varying(255),
    "targetActorHost" character varying(255),
    status character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    inbox character varying(255),
    "sharedInbox" character varying(255),
    reblogs boolean DEFAULT true NOT NULL,
    notify boolean DEFAULT false NOT NULL,
    languages text
);

CREATE TABLE gallery_album_items (
    "albumId" character varying(255) NOT NULL,
    "mediaId" integer NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE gallery_albums (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    title character varying(120) NOT NULL,
    description text,
    "coverMediaId" integer,
    visibility character varying(16) DEFAULT 'public'::character varying NOT NULL,
    "sortOrder" character varying(16) DEFAULT 'taken_desc'::character varying NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE gallery_gears (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    kind character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    brand character varying(255),
    model character varying(255),
    "productUrl" character varying(255),
    "deviceKey" character varying(255),
    "retiredAt" timestamp with time zone,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "deletedAt" timestamp with time zone
);

CREATE TABLE gallery_lookup_cache (
    kind character varying(32) NOT NULL,
    key character varying(255) NOT NULL,
    outcome character varying(8) NOT NULL,
    value text,
    "fetchedAt" timestamp with time zone NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL
);

CREATE TABLE gallery_settings (
    "actorId" character varying(255) NOT NULL,
    "autoDescribe" boolean DEFAULT true NOT NULL,
    "allowEmptyDescription" boolean DEFAULT true NOT NULL,
    "subjectHashtags" boolean DEFAULT true NOT NULL,
    "galleryDefault" character varying(255) DEFAULT 'subject'::character varying NOT NULL,
    "defaultPlacePrecision" character varying(255) DEFAULT 'hidden'::character varying NOT NULL,
    "showGear" boolean DEFAULT true NOT NULL,
    "mapPublic" boolean DEFAULT true NOT NULL,
    "lifeListPublic" boolean DEFAULT false NOT NULL,
    "hiddenLocations" text DEFAULT '[]'::text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL,
    "hideThreatenedPlaces" boolean DEFAULT true NOT NULL,
    "subjectSuggestionMode" character varying(16) DEFAULT 'model'::character varying NOT NULL,
    "subjectConfidenceThreshold" integer DEFAULT 70 NOT NULL,
    "photoEnhance" boolean DEFAULT true NOT NULL
);

CREATE TABLE idempotency_keys (
    "actorId" character varying(255) NOT NULL,
    key character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE instance_rules (
    id character varying(255) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    text text NOT NULL,
    hint text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE jwks (
    id character varying(255) NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp with time zone,
    alg character varying(255),
    crv character varying(255)
);

CREATE TABLE legacy_fitness_heatmap_media_cleanup (
    "actorId" character varying(255) NOT NULL,
    "imagePath" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "deletedAt" timestamp with time zone,
    error text
);

CREATE TABLE likes (
    "statusId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE link_previews (
    "urlHash" character varying(64) NOT NULL,
    url text NOT NULL,
    type character varying(32) DEFAULT 'link'::character varying NOT NULL,
    title text,
    description text,
    "siteName" character varying(255),
    "authorName" character varying(255),
    "authorUrl" text,
    "imageUrl" text,
    "imageWidth" integer,
    "imageHeight" integer,
    "publishedAt" timestamp with time zone,
    "fetchStatus" character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    error text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE list_accounts (
    id character varying(255) NOT NULL,
    "listId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE lists (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    "repliesPolicy" character varying(255) DEFAULT 'list'::character varying NOT NULL,
    exclusive boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE markers (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    timeline character varying(255) NOT NULL,
    "lastReadId" text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE media_edit_files (
    id character varying(36) NOT NULL,
    "mediaId" integer NOT NULL,
    "actorId" character varying(255) NOT NULL,
    slot character varying(64) NOT NULL,
    path character varying(255) NOT NULL,
    bytes bigint NOT NULL,
    "mimeType" character varying(64) NOT NULL,
    "metaData" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE medias (
    id integer NOT NULL,
    "actorId" character varying(255),
    original character varying(255),
    thumbnail character varying(255),
    description text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "accountId" character varying(255),
    "originalMimeType" character varying(255),
    "originalBytes" bigint,
    "thumbnailBytes" bigint,
    "thumbnailMimeType" character varying(255),
    "originalMetaData" jsonb,
    "thumbnailMetaData" jsonb,
    "originalFileName" character varying(255),
    "focusX" double precision,
    "focusY" double precision,
    blurhash character varying(255),
    "subjectName" character varying(255),
    "subjectScientificName" character varying(255),
    "subjectCategory" character varying(32),
    "takenAt" timestamp with time zone,
    "cameraGearId" character varying(255),
    "lensGearId" character varying(255),
    exposure text,
    "placeName" character varying(255),
    "placeLatitude" double precision,
    "placeLongitude" double precision,
    "placePrecision" character varying(16),
    "inGallery" boolean DEFAULT false NOT NULL,
    "subjectTaxonKey" character varying(32),
    "subjectTaxonPath" text,
    "subjectIucnCategory" character varying(2),
    "subjectLookupStatus" character varying(16),
    "subjectLookupAt" timestamp with time zone,
    "subjectSuggestions" text,
    "placeCountryCode" character varying(2),
    "placeNameSource" character varying(16),
    "placeLookupStatus" character varying(16),
    "placeLookupAt" timestamp with time zone,
    "editRecipe" text,
    "editVersion" integer DEFAULT 0 NOT NULL,
    "editedAt" timestamp with time zone,
    "editSaveId" character varying(36),
    "galleryAddedAt" timestamp with time zone
);

CREATE SEQUENCE medias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE medias_id_seq OWNED BY medias.id;

CREATE TABLE moderation_actions (
    id character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "moderatorAccountId" character varying(255) NOT NULL,
    "moderatorActorId" character varying(255),
    action character varying(32) NOT NULL,
    "reportId" character varying(255),
    text text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mutes (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "actorHost" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "targetActorHost" character varying(255) NOT NULL,
    notifications boolean DEFAULT true NOT NULL,
    "endsAt" bigint,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    type character varying(255) NOT NULL,
    "sourceActorId" character varying(255) NOT NULL,
    "statusId" character varying(255),
    "followId" character varying(255),
    "isRead" boolean DEFAULT false,
    "readAt" timestamp with time zone,
    "groupKey" character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    filtered boolean DEFAULT false NOT NULL,
    "reactionName" character varying(255)
);

CREATE TABLE "oauthAccessToken" (
    id character varying(255) NOT NULL,
    token text NOT NULL,
    "clientId" character varying(255) NOT NULL,
    "sessionId" character varying(255),
    "userId" character varying(255),
    "referenceId" character varying(255),
    "refreshId" character varying(255),
    "expiresAt" timestamp with time zone NOT NULL,
    scopes text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "authorizationCodeId" character varying(255),
    resources text,
    "requestedUserInfoClaims" text,
    revoked timestamp with time zone,
    confirmation text
);

CREATE TABLE "oauthClient" (
    id character varying(255) NOT NULL,
    "clientId" character varying(255) NOT NULL,
    "clientSecret" text,
    disabled boolean DEFAULT false,
    "skipConsent" boolean,
    "enableEndSession" boolean,
    "subjectType" character varying(255),
    scopes text,
    "userId" character varying(255),
    name character varying(255),
    uri character varying(255),
    icon character varying(255),
    contacts text,
    tos character varying(255),
    policy character varying(255),
    "softwareId" character varying(255),
    "softwareVersion" character varying(255),
    "softwareStatement" text,
    "redirectUris" text NOT NULL,
    "postLogoutRedirectUris" text,
    "tokenEndpointAuthMethod" character varying(255),
    "grantTypes" text,
    "responseTypes" text,
    public boolean,
    type character varying(255),
    "requirePKCE" boolean,
    "referenceId" character varying(255),
    metadata text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "clientDiscoveryId" character varying(255),
    "clientCredentialsScopes" text,
    "backchannelLogoutUri" character varying(255),
    "backchannelLogoutSessionRequired" boolean,
    "applicationType" character varying(255),
    jwks text,
    "jwksUri" character varying(255),
    "dpopBoundAccessTokens" boolean DEFAULT false
);

CREATE TABLE "oauthClientAssertion" (
    id character varying(255) NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL
);

CREATE TABLE "oauthClientResource" (
    id character varying(255) NOT NULL,
    "clientId" character varying(255) NOT NULL,
    "resourceId" character varying(255) NOT NULL,
    metadata text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "oauthConsent" (
    id character varying(255) NOT NULL,
    "clientId" character varying(255) NOT NULL,
    "userId" character varying(255),
    "referenceId" character varying(255),
    scopes text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    resources text,
    "requestedUserInfoClaims" text
);

CREATE TABLE "oauthRefreshToken" (
    id character varying(255) NOT NULL,
    token text NOT NULL,
    "clientId" character varying(255) NOT NULL,
    "sessionId" character varying(255),
    "userId" character varying(255) NOT NULL,
    "referenceId" character varying(255),
    "expiresAt" timestamp with time zone NOT NULL,
    revoked timestamp with time zone,
    "authTime" timestamp with time zone,
    scopes text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "authorizationCodeId" character varying(255),
    resources text,
    "requestedUserInfoClaims" text,
    "rotatedAt" timestamp with time zone,
    "rotationReplayResponse" text,
    "rotationReplayExpiresAt" timestamp with time zone,
    confirmation text
);

CREATE TABLE "oauthResource" (
    id character varying(255) NOT NULL,
    identifier character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "accessTokenTtl" integer,
    "refreshTokenTtl" integer,
    "signingAlgorithm" character varying(255),
    "signingKeyId" character varying(255),
    "allowedScopes" text,
    "customClaims" text,
    "dpopBoundAccessTokensRequired" boolean,
    disabled boolean,
    "policyVersion" integer,
    metadata text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE passkey (
    id character varying(255) NOT NULL,
    name character varying(255),
    "publicKey" text NOT NULL,
    "userId" character varying(255) NOT NULL,
    "credentialID" text NOT NULL,
    counter integer DEFAULT 0 NOT NULL,
    "deviceType" character varying(255) NOT NULL,
    "backedUp" boolean DEFAULT false NOT NULL,
    transports character varying(255),
    aaguid character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "rpID" character varying(255)
);

CREATE TABLE poll_answers (
    "answerId" integer NOT NULL,
    choice integer NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "statusId" character varying(255) NOT NULL
);

CREATE SEQUENCE "poll_answers_answerId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "poll_answers_answerId_seq" OWNED BY poll_answers."answerId";

CREATE TABLE poll_choices (
    "choiceId" integer NOT NULL,
    "statusId" character varying(255),
    title character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "totalVotes" integer DEFAULT 0 NOT NULL
);

CREATE SEQUENCE "poll_choices_choiceId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "poll_choices_choiceId_seq" OWNED BY poll_choices."choiceId";

CREATE TABLE poll_voters (
    id integer NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE poll_voters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE poll_voters_id_seq OWNED BY poll_voters.id;

CREATE TABLE push_subscriptions (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    endpoint text NOT NULL,
    p256dh character varying(255) NOT NULL,
    auth character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    alerts text,
    policy character varying(255) DEFAULT 'all'::character varying NOT NULL,
    standard boolean DEFAULT true NOT NULL,
    "accessToken" text
);

CREATE TABLE queue_jobs (
    id character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    payload jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_retries integer DEFAULT 16 NOT NULL,
    next_run_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    last_error_message text,
    last_error_stack text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    claim_token character varying(255) DEFAULT NULL::character varying
);

CREATE TABLE recipients (
    id character varying(255) NOT NULL,
    "statusId" character varying(255),
    "actorId" character varying(255),
    type character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE relays (
    id character varying(255) NOT NULL,
    "inboxUrl" character varying(255) NOT NULL,
    "actorId" character varying(255),
    state character varying(255) DEFAULT 'idle'::character varying NOT NULL,
    "followActivityId" character varying(255),
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reports (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    category character varying(255) DEFAULT 'other'::character varying NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    forward boolean DEFAULT false NOT NULL,
    "statusIds" text DEFAULT '[]'::text NOT NULL,
    "ruleIds" text DEFAULT '[]'::text NOT NULL,
    "actionTaken" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "collectionIds" text DEFAULT '[]'::text NOT NULL,
    "assignedActorId" character varying(255),
    "actionTakenAt" timestamp with time zone,
    "actionTakenByActorId" character varying(255)
);

CREATE TABLE scheduled_statuses (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "scheduledAt" timestamp with time zone NOT NULL,
    params text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE search_documents (
    id character varying(320) NOT NULL,
    "entityType" character varying(32) NOT NULL,
    "entityId" character varying(255) NOT NULL,
    "documentText" text NOT NULL,
    "actorId" character varying(255),
    visibility character varying(32),
    "entityCreatedAt" timestamp with time zone,
    discoverable boolean,
    "postCount" integer,
    "lastPostAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE server_filter_keywords (
    id character varying(255) NOT NULL,
    "filterId" character varying(255) NOT NULL,
    keyword text NOT NULL,
    "wholeWord" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE server_filters (
    id character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    context text NOT NULL,
    "filterAction" character varying(255) DEFAULT 'warn'::character varying NOT NULL,
    "expiresAt" bigint,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE server_settings (
    key character varying(255) NOT NULL,
    value text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE sessions (
    id character varying(255) NOT NULL,
    "accountId" character varying(255),
    token character varying(255),
    "expireAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "actorId" character varying(255),
    "ipAddress" text,
    "userAgent" text
);

CREATE TABLE status_detected_languages (
    "statusId" character varying(255) NOT NULL,
    language character varying(16) NOT NULL,
    confidence real,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE status_history (
    id integer NOT NULL,
    "statusId" character varying(255),
    data jsonb,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE status_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE status_history_id_seq OWNED BY status_history.id;

CREATE TABLE status_link_previews (
    "statusId" character varying(255) NOT NULL,
    "urlHash" character varying(64) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE status_mutes (
    "actorId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE status_pins (
    "actorId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE status_quotes (
    "statusId" character varying(255) NOT NULL,
    "quotedStatusId" character varying(255) NOT NULL,
    state character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    "quoteRequestId" text,
    "authorizationUri" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE status_reactions (
    "statusId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    url text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE statuses (
    id character varying(255) NOT NULL,
    "actorId" character varying(255),
    type character varying(255),
    reply character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    content text,
    url text,
    "urlHash" character varying(64),
    "originalStatusId" character varying(255),
    "replyHash" character varying(64),
    "applicationName" character varying(255),
    "applicationWebsite" character varying(255),
    "publicId" character varying(36)
);

CREATE TABLE strava_archive_imports (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "archiveId" character varying(255) NOT NULL,
    "archiveFitnessFileId" character varying(255) NOT NULL,
    "batchId" character varying(255) NOT NULL,
    visibility character varying(255) NOT NULL,
    status character varying(255) NOT NULL,
    "nextActivityIndex" integer DEFAULT 0 NOT NULL,
    "pendingMediaActivities" text,
    "mediaAttachmentRetry" integer DEFAULT 0 NOT NULL,
    "totalActivitiesCount" integer,
    "completedActivitiesCount" integer DEFAULT 0 NOT NULL,
    "failedActivitiesCount" integer DEFAULT 0 NOT NULL,
    "firstFailureMessage" text,
    "lastError" text,
    "resolvedAt" timestamp with time zone,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE suggestion_dismissals (
    "actorId" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE tags (
    id character varying(255) NOT NULL,
    "statusId" character varying(255),
    type character varying(255),
    name character varying(255),
    value character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "nameNormalized" character varying(255)
);

CREATE TABLE timelines (
    id integer NOT NULL,
    "actorId" character varying(255),
    timeline character varying(255),
    "statusId" character varying(255),
    "statusActorId" character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE timelines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE timelines_id_seq OWNED BY timelines.id;

CREATE TABLE tokens (
    "accessToken" character varying(255) NOT NULL,
    "refreshToken" character varying(255),
    "accessTokenExpiresAt" timestamp with time zone,
    "refreshTokenExpiresAt" timestamp with time zone,
    "clientId" character varying(255),
    "actorId" character varying(255),
    "accountId" character varying(255),
    scopes jsonb,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE translation_cache (
    provider character varying(191) NOT NULL,
    "sourceLanguage" character varying(16) NOT NULL,
    "targetLanguage" character varying(16) NOT NULL,
    "sourceHash" character varying(64) NOT NULL,
    content text NOT NULL,
    "detectedSourceLanguage" character varying(16),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "twoFactor" (
    id character varying(255) NOT NULL,
    secret text NOT NULL,
    "backupCodes" text NOT NULL,
    "userId" character varying(255) NOT NULL,
    verified boolean DEFAULT false NOT NULL,
    "failedVerificationCount" integer DEFAULT 0 NOT NULL,
    "lockedUntil" timestamp with time zone
);

CREATE TABLE verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE wahoo_history_imports (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "providerUserId" character varying(255) NOT NULL,
    "fromDate" date NOT NULL,
    "toDate" date NOT NULL,
    "nextPage" integer DEFAULT 1 NOT NULL,
    "scanComplete" boolean DEFAULT false NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    completed integer DEFAULT 0 NOT NULL,
    failed integer DEFAULT 0 NOT NULL,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE wahoo_imports (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "providerUserId" character varying(255) NOT NULL,
    "workoutId" character varying(255) NOT NULL,
    "summaryId" character varying(255),
    "summaryUpdatedAt" timestamp with time zone,
    "fitnessFileId" character varying(255),
    "statusId" character varying(255),
    "historyImportId" character varying(255),
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    "hadStatus" boolean DEFAULT false NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY bookmarks ALTER COLUMN id SET DEFAULT nextval('bookmarks_id_seq'::regclass);

ALTER TABLE ONLY collection_members ALTER COLUMN seq SET DEFAULT nextval('collection_members_seq_seq'::regclass);

ALTER TABLE ONLY collection_timeline ALTER COLUMN id SET DEFAULT nextval('collection_timeline_id_seq'::regclass);

ALTER TABLE ONLY collections ALTER COLUMN seq SET DEFAULT nextval('collections_seq_seq'::regclass);

ALTER TABLE ONLY direct_conversation_memberships ALTER COLUMN id SET DEFAULT nextval('direct_conversation_memberships_id_seq'::regclass);

ALTER TABLE ONLY endorsements ALTER COLUMN id SET DEFAULT nextval('endorsements_id_seq'::regclass);

ALTER TABLE ONLY medias ALTER COLUMN id SET DEFAULT nextval('medias_id_seq'::regclass);

ALTER TABLE ONLY poll_answers ALTER COLUMN "answerId" SET DEFAULT nextval('"poll_answers_answerId_seq"'::regclass);

ALTER TABLE ONLY poll_choices ALTER COLUMN "choiceId" SET DEFAULT nextval('"poll_choices_choiceId_seq"'::regclass);

ALTER TABLE ONLY poll_voters ALTER COLUMN id SET DEFAULT nextval('poll_voters_id_seq'::regclass);

ALTER TABLE ONLY status_history ALTER COLUMN id SET DEFAULT nextval('status_history_id_seq'::regclass);

ALTER TABLE ONLY timelines ALTER COLUMN id SET DEFAULT nextval('timelines_id_seq'::regclass);

ALTER TABLE ONLY account_providers
    ADD CONSTRAINT "accountProviders_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY account_notes
    ADD CONSTRAINT account_notes_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY account_notes
    ADD CONSTRAINT account_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY accounts
    ADD CONSTRAINT accounts_email_unique UNIQUE (email);

ALTER TABLE ONLY accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY actor_domain_blocks
    ADD CONSTRAINT actor_domain_blocks_actor_domain_unique UNIQUE ("actorId", domain);

ALTER TABLE ONLY actor_domain_blocks
    ADD CONSTRAINT actor_domain_blocks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY actors
    ADD CONSTRAINT actors_id_unique UNIQUE (id);

ALTER TABLE ONLY actors
    ADD CONSTRAINT actors_publicid_unique UNIQUE ("publicId");

ALTER TABLE ONLY actors
    ADD CONSTRAINT actors_username_domain_unique UNIQUE (username, domain);

ALTER TABLE ONLY announcement_reactions
    ADD CONSTRAINT announcement_reactions_pkey PRIMARY KEY ("announcementId", "actorId", name);

ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_pkey PRIMARY KEY ("announcementId", "actorId");

ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY clients
    ADD CONSTRAINT applications_clientname_unique UNIQUE (name);

ALTER TABLE ONLY clients
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY auth_codes
    ADD CONSTRAINT auth_codes_pkey PRIMARY KEY (code);

ALTER TABLE ONLY blocks
    ADD CONSTRAINT blocks_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY blocks
    ADD CONSTRAINT blocks_uri_unique UNIQUE (uri);

ALTER TABLE ONLY bookmarks
    ADD CONSTRAINT bookmarks_actor_status_unique UNIQUE ("actorId", "statusId");

ALTER TABLE ONLY bookmarks
    ADD CONSTRAINT bookmarks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY collection_members
    ADD CONSTRAINT collection_members_collection_target_unique UNIQUE ("collectionSeq", "targetActorId");

ALTER TABLE ONLY collection_members
    ADD CONSTRAINT collection_members_id_unique UNIQUE (id);

ALTER TABLE ONLY collection_members
    ADD CONSTRAINT collection_members_pkey PRIMARY KEY (seq);

ALTER TABLE ONLY collection_timeline
    ADD CONSTRAINT collection_timeline_collection_status_unique UNIQUE ("collectionSeq", "statusId");

ALTER TABLE ONLY collection_timeline
    ADD CONSTRAINT collection_timeline_pkey PRIMARY KEY (id);

ALTER TABLE ONLY collections
    ADD CONSTRAINT collections_id_unique UNIQUE (id);

ALTER TABLE ONLY collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (seq);

ALTER TABLE ONLY counters
    ADD CONSTRAINT counters_tmp_new_pkey PRIMARY KEY (id);

ALTER TABLE ONLY "customEmojis"
    ADD CONSTRAINT "customEmojis_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "customEmojis"
    ADD CONSTRAINT customemojis_shortcode_unique UNIQUE (shortcode);

ALTER TABLE ONLY dead_letter_jobs
    ADD CONSTRAINT dead_letter_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY direct_conversation_memberships
    ADD CONSTRAINT direct_conversation_memberships_pkey PRIMARY KEY (id);

ALTER TABLE ONLY direct_conversation_participants
    ADD CONSTRAINT direct_conversation_participants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY direct_conversation_statuses
    ADD CONSTRAINT direct_conversation_statuses_pkey PRIMARY KEY ("conversationId", "statusId");

ALTER TABLE ONLY direct_conversations
    ADD CONSTRAINT direct_conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY direct_conversation_memberships
    ADD CONSTRAINT direct_membership_actor_conversation UNIQUE ("actorId", "conversationId");

ALTER TABLE ONLY direct_conversation_participants
    ADD CONSTRAINT direct_participant_conversation_actor UNIQUE ("conversationId", "actorId");

ALTER TABLE ONLY domain_federation_rules
    ADD CONSTRAINT domain_federation_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY domain_federation_rules
    ADD CONSTRAINT domain_federation_rules_type_domain_unique UNIQUE (type, domain);

ALTER TABLE ONLY endorsements
    ADD CONSTRAINT endorsements_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY endorsements
    ADD CONSTRAINT endorsements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY featured_tags
    ADD CONSTRAINT featured_tags_actor_name_unique UNIQUE ("actorId", "nameNormalized");

ALTER TABLE ONLY featured_tags
    ADD CONSTRAINT featured_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY federated_timeline
    ADD CONSTRAINT federated_timeline_pkey PRIMARY KEY ("statusId");

ALTER TABLE ONLY filter_keywords
    ADD CONSTRAINT filter_keywords_filter_keyword_unique UNIQUE ("filterId", keyword);

ALTER TABLE ONLY filter_keywords
    ADD CONSTRAINT filter_keywords_pkey PRIMARY KEY (id);

ALTER TABLE ONLY filter_statuses
    ADD CONSTRAINT filter_statuses_filter_status_unique UNIQUE ("filterId", "statusId");

ALTER TABLE ONLY filter_statuses
    ADD CONSTRAINT filter_statuses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY filters
    ADD CONSTRAINT filters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fitness_file_routes
    ADD CONSTRAINT fitness_file_routes_pkey PRIMARY KEY ("fitnessFileId");

ALTER TABLE ONLY fitness_files
    ADD CONSTRAINT fitness_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fitness_gear_component_periods
    ADD CONSTRAINT fitness_gear_component_periods_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fitness_gear_component_periods
    ADD CONSTRAINT fitness_gear_component_periods_sequence_unique UNIQUE ("componentId", "installSequence");

ALTER TABLE ONLY fitness_gear_components
    ADD CONSTRAINT fitness_gear_components_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fitness_gears
    ADD CONSTRAINT fitness_gears_actor_device_key_unique UNIQUE ("actorId", "deviceKey");

ALTER TABLE ONLY fitness_gears
    ADD CONSTRAINT fitness_gears_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fitness_import_locks
    ADD CONSTRAINT fitness_import_locks_pkey PRIMARY KEY ("lockKey");

ALTER TABLE ONLY fitness_route_heatmap_pyramids
    ADD CONSTRAINT fitness_route_heatmap_pyramids_actor_unique UNIQUE ("actorId");

ALTER TABLE ONLY fitness_route_heatmap_pyramids
    ADD CONSTRAINT fitness_route_heatmap_pyramids_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fitness_route_heatmap_region_names
    ADD CONSTRAINT fitness_route_heatmap_region_names_pkey PRIMARY KEY ("actorId", region);

ALTER TABLE ONLY fitness_route_heatmap_tiles
    ADD CONSTRAINT fitness_route_heatmap_tiles_pkey PRIMARY KEY ("actorId", "tileKey");

ALTER TABLE ONLY fitness_route_heatmaps
    ADD CONSTRAINT fitness_route_heatmaps_actorid_activitytypekey_periodtype_perio UNIQUE ("actorId", "activityTypeKey", "periodType", "periodKey", region);

ALTER TABLE ONLY fitness_route_heatmaps
    ADD CONSTRAINT fitness_route_heatmaps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY fitness_route_heatmaps
    ADD CONSTRAINT fitness_route_heatmaps_sharetoken_unique UNIQUE ("shareToken");

ALTER TABLE ONLY fitness_settings
    ADD CONSTRAINT fitness_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY followed_tags
    ADD CONSTRAINT followed_tags_actor_name_unique UNIQUE ("actorId", "nameNormalized");

ALTER TABLE ONLY followed_tags
    ADD CONSTRAINT followed_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gallery_album_items
    ADD CONSTRAINT gallery_album_items_pkey PRIMARY KEY ("albumId", "mediaId");

ALTER TABLE ONLY gallery_albums
    ADD CONSTRAINT gallery_albums_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gallery_gears
    ADD CONSTRAINT gallery_gears_actor_device_key_unique UNIQUE ("actorId", "deviceKey");

ALTER TABLE ONLY gallery_gears
    ADD CONSTRAINT gallery_gears_pkey PRIMARY KEY (id);

ALTER TABLE ONLY gallery_lookup_cache
    ADD CONSTRAINT gallery_lookup_cache_pkey PRIMARY KEY (kind, key);

ALTER TABLE ONLY gallery_settings
    ADD CONSTRAINT gallery_settings_pkey PRIMARY KEY ("actorId");

ALTER TABLE ONLY idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY ("actorId", key);

ALTER TABLE ONLY instance_rules
    ADD CONSTRAINT instance_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY legacy_fitness_heatmap_media_cleanup
    ADD CONSTRAINT legacy_fitness_heatmap_media_cleanup_pkey PRIMARY KEY ("actorId", "imagePath");

ALTER TABLE ONLY likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY ("statusId", "actorId");

ALTER TABLE ONLY link_previews
    ADD CONSTRAINT link_previews_pkey PRIMARY KEY ("urlHash");

ALTER TABLE ONLY list_accounts
    ADD CONSTRAINT list_accounts_list_target_unique UNIQUE ("listId", "targetActorId");

ALTER TABLE ONLY list_accounts
    ADD CONSTRAINT list_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY lists
    ADD CONSTRAINT lists_pkey PRIMARY KEY (id);

ALTER TABLE ONLY markers
    ADD CONSTRAINT markers_actor_timeline_unique UNIQUE ("actorId", timeline);

ALTER TABLE ONLY markers
    ADD CONSTRAINT markers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY media_edit_files
    ADD CONSTRAINT media_edit_files_media_slot_unique UNIQUE ("mediaId", slot);

ALTER TABLE ONLY media_edit_files
    ADD CONSTRAINT media_edit_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY medias
    ADD CONSTRAINT medias_pkey PRIMARY KEY (id);

ALTER TABLE ONLY moderation_actions
    ADD CONSTRAINT moderation_actions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY mutes
    ADD CONSTRAINT mutes_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY mutes
    ADD CONSTRAINT mutes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY "oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "oauthClientAssertion"
    ADD CONSTRAINT "oauthClientAssertion_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "oauthClientResource"
    ADD CONSTRAINT "oauthClientResource_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "oauthClient"
    ADD CONSTRAINT "oauthClient_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "oauthConsent"
    ADD CONSTRAINT "oauthConsent_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "oauthResource"
    ADD CONSTRAINT "oauthResource_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_token_unique UNIQUE (token);

ALTER TABLE ONLY "oauthClient"
    ADD CONSTRAINT oauthclient_clientid_unique UNIQUE ("clientId");

ALTER TABLE ONLY "oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_token_unique UNIQUE (token);

ALTER TABLE ONLY "oauthResource"
    ADD CONSTRAINT oauthresource_identifier_unique UNIQUE (identifier);

ALTER TABLE ONLY passkey
    ADD CONSTRAINT passkey_credentialid_unique UNIQUE ("credentialID");

ALTER TABLE ONLY passkey
    ADD CONSTRAINT passkey_pkey PRIMARY KEY (id);

ALTER TABLE ONLY poll_answers
    ADD CONSTRAINT poll_answers_pkey PRIMARY KEY ("answerId");

ALTER TABLE ONLY poll_choices
    ADD CONSTRAINT poll_choices_pkey PRIMARY KEY ("choiceId");

ALTER TABLE ONLY poll_voters
    ADD CONSTRAINT poll_voters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY poll_voters
    ADD CONSTRAINT poll_voters_statusid_actorid_unique UNIQUE ("statusId", "actorId");

ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint);

ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY queue_jobs
    ADD CONSTRAINT queue_jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY recipients
    ADD CONSTRAINT recipients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY relays
    ADD CONSTRAINT relays_inboxurl_unique UNIQUE ("inboxUrl");

ALTER TABLE ONLY relays
    ADD CONSTRAINT relays_pkey PRIMARY KEY (id);

ALTER TABLE ONLY reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY scheduled_statuses
    ADD CONSTRAINT scheduled_statuses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY search_documents
    ADD CONSTRAINT search_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY server_filter_keywords
    ADD CONSTRAINT server_filter_keywords_filter_keyword_unique UNIQUE ("filterId", keyword);

ALTER TABLE ONLY server_filter_keywords
    ADD CONSTRAINT server_filter_keywords_pkey PRIMARY KEY (id);

ALTER TABLE ONLY server_filters
    ADD CONSTRAINT server_filters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY server_settings
    ADD CONSTRAINT server_settings_pkey PRIMARY KEY (key);

ALTER TABLE ONLY sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY status_detected_languages
    ADD CONSTRAINT status_detected_languages_pkey PRIMARY KEY ("statusId");

ALTER TABLE ONLY status_history
    ADD CONSTRAINT status_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY status_link_previews
    ADD CONSTRAINT status_link_previews_pkey PRIMARY KEY ("statusId");

ALTER TABLE ONLY status_mutes
    ADD CONSTRAINT status_mutes_pkey PRIMARY KEY ("actorId", "statusId");

ALTER TABLE ONLY status_pins
    ADD CONSTRAINT status_pins_pkey PRIMARY KEY ("actorId", "statusId");

ALTER TABLE ONLY status_quotes
    ADD CONSTRAINT status_quotes_pkey PRIMARY KEY ("statusId");

ALTER TABLE ONLY status_reactions
    ADD CONSTRAINT status_reactions_pkey PRIMARY KEY ("statusId", "actorId", name);

ALTER TABLE ONLY statuses
    ADD CONSTRAINT statuses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY statuses
    ADD CONSTRAINT statuses_publicid_unique UNIQUE ("publicId");

ALTER TABLE ONLY strava_archive_imports
    ADD CONSTRAINT strava_archive_imports_archiveid_unique UNIQUE ("archiveId");

ALTER TABLE ONLY strava_archive_imports
    ADD CONSTRAINT strava_archive_imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY suggestion_dismissals
    ADD CONSTRAINT suggestion_dismissals_pkey PRIMARY KEY ("actorId", "targetActorId");

ALTER TABLE ONLY tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY timelines
    ADD CONSTRAINT "timelines_actorId_timeline_statusId_unique" UNIQUE ("actorId", timeline, "statusId");

ALTER TABLE ONLY timelines
    ADD CONSTRAINT timelines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY ("accessToken");

ALTER TABLE ONLY translation_cache
    ADD CONSTRAINT translation_cache_pkey PRIMARY KEY (provider, "sourceLanguage", "targetLanguage", "sourceHash");

ALTER TABLE ONLY "twoFactor"
    ADD CONSTRAINT "twoFactor_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY "twoFactor"
    ADD CONSTRAINT twofactor_userid_unique UNIQUE ("userId");

ALTER TABLE ONLY verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wahoo_history_imports
    ADD CONSTRAINT wahoo_history_imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY wahoo_imports
    ADD CONSTRAINT wahoo_imports_actorid_provideruserid_workoutid_unique UNIQUE ("actorId", "providerUserId", "workoutId");

ALTER TABLE ONLY wahoo_imports
    ADD CONSTRAINT wahoo_imports_pkey PRIMARY KEY (id);

CREATE INDEX "account_providers_accountId_provider_providerId_idx" ON account_providers USING btree ("accountId", provider, "providerId");

CREATE INDEX "accountsIndex" ON accounts USING btree (email, "createdAt", "updatedAt");

CREATE INDEX actor_domain_blocks_actor_created ON actor_domain_blocks USING btree ("actorId", "createdAt");

CREATE INDEX "actorsIndex" ON actors USING btree (username, "createdAt", "updatedAt");

CREATE INDEX "actors_accountId_idx" ON actors USING btree ("accountId");

CREATE INDEX actors_domain_last_status_at_idx ON actors USING btree (domain, "lastStatusAt");

CREATE INDEX actors_local_idx ON actors USING btree (id) WHERE ("privateKey" IS NOT NULL);

CREATE INDEX actors_lower_username_domain_idx ON actors USING btree (lower((username)::text), domain);

CREATE INDEX "attachmentsIndex" ON attachments USING btree ("statusId", "createdAt", "updatedAt");

CREATE INDEX "attachments_actorId_idx" ON attachments USING btree ("actorId");

CREATE INDEX "attachments_mediaId_idx" ON attachments USING btree ("mediaId");

CREATE INDEX blocks_actor_created ON blocks USING btree ("actorId", "createdAt");

CREATE INDEX blocks_target ON blocks USING btree ("targetActorId");

CREATE INDEX bookmarks_actor_created_id ON bookmarks USING btree ("actorId", "createdAt", id);

CREATE INDEX bookmarks_actor_source_status ON bookmarks USING btree ("actorId", "sourceStatusId");

CREATE INDEX bookmarks_status ON bookmarks USING btree ("statusId");

CREATE INDEX collection_members_target ON collection_members USING btree ("targetActorId");

CREATE INDEX collection_timeline_member ON collection_timeline USING btree ("memberSeq");

CREATE INDEX collection_timeline_read ON collection_timeline USING btree ("collectionSeq", "sortKey");

CREATE INDEX collection_timeline_status ON collection_timeline USING btree ("statusId");

CREATE INDEX collections_owner_created ON collections USING btree ("ownerActorId", "createdAt");

CREATE INDEX "countersIndex" ON counters USING btree (id, "createdAt", "updatedAt");

CREATE INDEX counters_bucket_hour_index ON counters USING btree ("bucketHour");

CREATE INDEX dead_letter_jobs_created_at_idx ON dead_letter_jobs USING btree (created_at);

CREATE INDEX dead_letter_jobs_job_name_idx ON dead_letter_jobs USING btree (job_name);

CREATE INDEX dead_letter_jobs_status_idx ON dead_letter_jobs USING btree (status);

CREATE INDEX direct_conversation_status ON direct_conversation_statuses USING btree ("statusId");

CREATE INDEX direct_conversation_statuses_order ON direct_conversation_statuses USING btree ("conversationId", "createdAt", "statusId");

CREATE INDEX direct_conversations_root_status ON direct_conversations USING btree ("rootStatusId");

CREATE INDEX direct_membership_actor_visible ON direct_conversation_memberships USING btree ("actorId", "hiddenAt", "lastStatusCreatedAt", id);

CREATE INDEX direct_membership_last_status ON direct_conversation_memberships USING btree ("lastStatusId");

CREATE INDEX direct_participant_actor ON direct_conversation_participants USING btree ("actorId");

CREATE INDEX domain_federation_rules_source_idx ON domain_federation_rules USING btree (source);

CREATE INDEX domain_federation_rules_type_idx ON domain_federation_rules USING btree (type, "createdAt");

CREATE INDEX featured_tags_name ON featured_tags USING btree ("nameNormalized");

CREATE INDEX federated_timeline_status_actor_id ON federated_timeline USING btree ("statusActorId");

CREATE INDEX filter_keywords_filter_id ON filter_keywords USING btree ("filterId");

CREATE INDEX filter_statuses_filter_id ON filter_statuses USING btree ("filterId");

CREATE INDEX filters_actor_created ON filters USING btree ("actorId", "createdAt");

CREATE INDEX fitness_file_routes_actor_id_idx ON fitness_file_routes USING btree ("actorId");

CREATE INDEX fitness_file_routes_actor_lat_idx ON fitness_file_routes USING btree ("actorId", "minLat", "maxLat");

CREATE INDEX fitness_files_actor_created_idx ON fitness_files USING btree ("actorId", "createdAt");

CREATE INDEX fitness_files_actor_id_idx ON fitness_files USING btree ("actorId");

CREATE INDEX fitness_files_device_gear_id_idx ON fitness_files USING btree ("deviceGearId");

CREATE INDEX fitness_files_gear_id_idx ON fitness_files USING btree ("gearId");

CREATE INDEX fitness_files_import_batch_id_idx ON fitness_files USING btree ("importBatchId");

CREATE INDEX fitness_files_status_id_idx ON fitness_files USING btree ("statusId");

CREATE INDEX fitness_gear_component_periods_component_id_idx ON fitness_gear_component_periods USING btree ("componentId");

CREATE INDEX fitness_gear_components_gear_id_idx ON fitness_gear_components USING btree ("gearId");

CREATE INDEX fitness_gears_actor_id_idx ON fitness_gears USING btree ("actorId");

CREATE INDEX fitness_import_locks_expiresat_index ON fitness_import_locks USING btree ("expiresAt");

CREATE INDEX fitness_route_heatmap_tiles_actor_version_idx ON fitness_route_heatmap_tiles USING btree ("actorId", version);

CREATE INDEX fitness_route_heatmap_tiles_actor_z_x_y_idx ON fitness_route_heatmap_tiles USING btree ("actorId", z, x, y);

CREATE INDEX fitness_route_heatmaps_actorid_periodtype_index ON fitness_route_heatmaps USING btree ("actorId", "periodType");

CREATE INDEX fitness_route_heatmaps_actorid_status_index ON fitness_route_heatmaps USING btree ("actorId", status);

CREATE INDEX fitness_settings_idx ON fitness_settings USING btree ("actorId", "serviceType", "deletedAt");

CREATE UNIQUE INDEX fitness_settings_unique_active ON fitness_settings USING btree ("actorId", "serviceType") WHERE ("deletedAt" IS NULL);

CREATE UNIQUE INDEX fitness_settings_wahoo_active_binding_uidx ON fitness_settings USING btree ("wahooWebhookTokenHash", "providerUserId") WHERE ((("serviceType")::text = 'wahoo'::text) AND ("deletedAt" IS NULL) AND ("wahooWebhookTokenHash" IS NOT NULL) AND ("providerUserId" IS NOT NULL));

CREATE INDEX fitness_settings_webhook_token_idx ON fitness_settings USING btree ("webhookToken");

CREATE INDEX followed_tags_name ON followed_tags USING btree ("nameNormalized");

CREATE INDEX "followsIndex" ON follows USING btree ("actorId", "actorHost", "targetActorId", "targetActorHost", status, "createdAt", "updatedAt");

CREATE INDEX gallery_album_items_media_idx ON gallery_album_items USING btree ("mediaId");

CREATE INDEX gallery_albums_actor_updated_idx ON gallery_albums USING btree ("actorId", "updatedAt");

CREATE INDEX gallery_gears_actor_id_idx ON gallery_gears USING btree ("actorId");

CREATE INDEX gallery_lookup_cache_expires_at_idx ON gallery_lookup_cache USING btree ("expiresAt");

CREATE INDEX idempotency_keys_created ON idempotency_keys USING btree ("createdAt");

CREATE INDEX idempotency_keys_status ON idempotency_keys USING btree ("statusId");

CREATE INDEX likes_actor_created_at_status_idx ON likes USING btree ("actorId", "createdAt", "statusId");

CREATE INDEX link_previews_status_updated_idx ON link_previews USING btree ("fetchStatus", "updatedAt");

CREATE INDEX list_accounts_target ON list_accounts USING btree ("targetActorId");

CREATE INDEX lists_actor_created ON lists USING btree ("actorId", "createdAt");

CREATE INDEX media_edit_files_actor_id_idx ON media_edit_files USING btree ("actorId");

CREATE INDEX "medias_accountId_originalMimeType_idx" ON medias USING btree ("accountId", "originalMimeType");

CREATE INDEX "medias_actorId_createdAt_idx" ON medias USING btree ("actorId", "createdAt");

CREATE INDEX "medias_actorId_originalMimeType_idx" ON medias USING btree ("actorId", "originalMimeType");

CREATE INDEX moderation_actions_report_idx ON moderation_actions USING btree ("reportId");

CREATE INDEX moderation_actions_target_idx ON moderation_actions USING btree ("targetActorId", "createdAt");

CREATE INDEX mutes_actor_created ON mutes USING btree ("actorId", "createdAt");

CREATE INDEX mutes_target ON mutes USING btree ("targetActorId");

CREATE INDEX notifications_actor_created ON notifications USING btree ("actorId", "createdAt");

CREATE INDEX notifications_actor_filtered ON notifications USING btree ("actorId", filtered, "createdAt");

CREATE INDEX notifications_actor_unread ON notifications USING btree ("actorId", "isRead", "createdAt");

CREATE INDEX notifications_follow_id ON notifications USING btree ("followId");

CREATE INDEX notifications_group_key ON notifications USING btree ("groupKey", "createdAt");

CREATE INDEX notifications_status_id ON notifications USING btree ("statusId");

CREATE INDEX oauth_client_reference_id_idx ON "oauthClient" USING btree ("referenceId");

CREATE INDEX passkey_userid_index ON passkey USING btree ("userId");

CREATE INDEX passkey_userid_rpid_index ON passkey USING btree ("userId", "rpID");

CREATE INDEX "passwordResetCodeIndex" ON accounts USING btree ("passwordResetCode");

CREATE INDEX poll_answers_statusid_actorid_index ON poll_answers USING btree ("statusId", "actorId");

CREATE INDEX poll_voters_statusid_index ON poll_voters USING btree ("statusId");

CREATE INDEX push_subscriptions_actor_idx ON push_subscriptions USING btree ("actorId");

CREATE INDEX queue_jobs_created_at_idx ON queue_jobs USING btree (created_at);

CREATE INDEX queue_jobs_name_idx ON queue_jobs USING btree (name);

CREATE INDEX queue_jobs_status_next_run_at_idx ON queue_jobs USING btree (status, next_run_at);

CREATE INDEX "recipiences_statusId_type_idx" ON recipients USING btree ("statusId", type, "createdAt", "updatedAt");

CREATE INDEX "recipients_actorId_statusId_idx" ON recipients USING btree ("actorId", "statusId");

CREATE INDEX recipients_status_type_actor_idx ON recipients USING btree ("statusId", type, "actorId");

CREATE INDEX recipients_type_actor_created_status_idx ON recipients USING btree (type, "actorId", "createdAt", "statusId");

CREATE INDEX relays_actor_id ON relays USING btree ("actorId");

CREATE INDEX relays_state ON relays USING btree (state);

CREATE INDEX reports_actor_created ON reports USING btree ("actorId", "createdAt");

CREATE INDEX reports_target ON reports USING btree ("targetActorId");

CREATE INDEX scheduled_statuses_actorid_index ON scheduled_statuses USING btree ("actorId");

CREATE INDEX scheduled_statuses_scheduledat_index ON scheduled_statuses USING btree ("scheduledAt");

CREATE INDEX search_documents_actor ON search_documents USING btree ("actorId");

CREATE INDEX search_documents_document_text_fts ON search_documents USING gin (to_tsvector('simple'::regconfig, "documentText"));

CREATE INDEX search_documents_entity_created ON search_documents USING btree ("entityCreatedAt");

CREATE INDEX search_documents_entity_type_entity_id ON search_documents USING btree ("entityType", "entityId");

CREATE INDEX search_documents_last_post ON search_documents USING btree ("lastPostAt");

CREATE INDEX search_documents_post_count ON search_documents USING btree ("postCount");

CREATE INDEX server_filter_keywords_filter_id ON server_filter_keywords USING btree ("filterId");

CREATE INDEX server_filters_created ON server_filters USING btree ("createdAt");

CREATE INDEX server_filters_expires_at ON server_filters USING btree ("expiresAt");

CREATE INDEX "sessions_accountId_token_idx" ON sessions USING btree ("accountId", token);

CREATE INDEX sessions_token_idx ON sessions USING btree (token);

CREATE INDEX "status_history_statusId_idx" ON status_history USING btree ("statusId", "createdAt", "updatedAt");

CREATE INDEX status_link_previews_urlhash_idx ON status_link_previews USING btree ("urlHash");

CREATE INDEX status_mutes_status ON status_mutes USING btree ("statusId");

CREATE INDEX status_pins_actor_created_status ON status_pins USING btree ("actorId", "createdAt", "statusId");

CREATE INDEX status_pins_status ON status_pins USING btree ("statusId");

CREATE INDEX status_quotes_authorization_idx ON status_quotes USING btree ("authorizationUri");

CREATE INDEX status_quotes_quoted_state_idx ON status_quotes USING btree ("quotedStatusId", state, "createdAt");

CREATE INDEX status_reactions_actor ON status_reactions USING btree ("actorId");

CREATE INDEX status_reactions_status_created ON status_reactions USING btree ("statusId", "createdAt");

CREATE INDEX "statusesReplyHashIndex" ON statuses USING btree ("replyHash");

CREATE INDEX "statusesReplyIndex" ON statuses USING btree (reply);

CREATE INDEX "statusesUrlHashIndex" ON statuses USING btree ("urlHash");

CREATE INDEX "statuses_actorId_idx" ON statuses USING btree ("actorId", "createdAt", "updatedAt");

CREATE INDEX statuses_announce_original_actor_idx ON statuses USING btree (type, "originalStatusId", "actorId");

CREATE INDEX statuses_reply_created_idx ON statuses USING btree (reply, "createdAt", id);

CREATE INDEX statuses_reply_type_idx ON statuses USING btree (reply, type);

CREATE UNIQUE INDEX strava_archive_imports_actor_active_idx ON strava_archive_imports USING btree ("actorId") WHERE ("resolvedAt" IS NULL);

CREATE INDEX strava_archive_imports_actor_status_idx ON strava_archive_imports USING btree ("actorId", status);

CREATE INDEX strava_archive_imports_batch_id_idx ON strava_archive_imports USING btree ("batchId");

CREATE INDEX "tags_nameNormalized_type_idx" ON tags USING btree ("nameNormalized", type);

CREATE INDEX "tags_statusId_type_idx" ON tags USING btree ("statusId", type, "createdAt", "updatedAt");

CREATE INDEX "timelinesActorIdTimelineCreatedAtIndex" ON timelines USING btree ("actorId", timeline, "createdAt");

CREATE INDEX "timelinesActorTimelineStatusActorIndex" ON timelines USING btree ("actorId", timeline, "statusActorId");

CREATE INDEX "timelinesStatusIdIndex" ON timelines USING btree ("statusId");

CREATE INDEX translation_cache_created ON translation_cache USING btree ("createdAt");

CREATE INDEX "verificationCodeIndex" ON accounts USING btree ("verificationCode");

CREATE INDEX verification_identifier_index ON verification USING btree (identifier);

CREATE INDEX wahoo_history_actor_status_idx ON wahoo_history_imports USING btree ("actorId", status);

CREATE INDEX wahoo_imports_actor_status_idx ON wahoo_imports USING btree ("actorId", status);

CREATE INDEX wahoo_imports_history_idx ON wahoo_imports USING btree ("historyImportId");

ALTER TABLE ONLY actors
    ADD CONSTRAINT actors_accountid_foreign FOREIGN KEY ("accountId") REFERENCES accounts(id);

ALTER TABLE ONLY federated_timeline
    ADD CONSTRAINT federated_timeline_statusid_foreign FOREIGN KEY ("statusId") REFERENCES statuses(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_file_routes
    ADD CONSTRAINT fitness_file_routes_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_file_routes
    ADD CONSTRAINT fitness_file_routes_fitnessfileid_foreign FOREIGN KEY ("fitnessFileId") REFERENCES fitness_files(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_files
    ADD CONSTRAINT fitness_files_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_files
    ADD CONSTRAINT fitness_files_statusid_foreign FOREIGN KEY ("statusId") REFERENCES statuses(id) ON DELETE SET NULL;

ALTER TABLE ONLY fitness_gear_component_periods
    ADD CONSTRAINT fitness_gear_component_periods_componentid_foreign FOREIGN KEY ("componentId") REFERENCES fitness_gear_components(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_gear_components
    ADD CONSTRAINT fitness_gear_components_gearid_foreign FOREIGN KEY ("gearId") REFERENCES fitness_gears(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_gears
    ADD CONSTRAINT fitness_gears_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_route_heatmap_pyramids
    ADD CONSTRAINT fitness_route_heatmap_pyramids_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_route_heatmap_region_names
    ADD CONSTRAINT fitness_route_heatmap_region_names_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_route_heatmap_tiles
    ADD CONSTRAINT fitness_route_heatmap_tiles_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY fitness_route_heatmaps
    ADD CONSTRAINT fitness_route_heatmaps_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id);

ALTER TABLE ONLY fitness_settings
    ADD CONSTRAINT fitness_settings_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id);

ALTER TABLE ONLY gallery_album_items
    ADD CONSTRAINT gallery_album_items_albumid_foreign FOREIGN KEY ("albumId") REFERENCES gallery_albums(id) ON DELETE CASCADE;

ALTER TABLE ONLY gallery_album_items
    ADD CONSTRAINT gallery_album_items_mediaid_foreign FOREIGN KEY ("mediaId") REFERENCES medias(id) ON DELETE CASCADE;

ALTER TABLE ONLY gallery_albums
    ADD CONSTRAINT gallery_albums_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY gallery_gears
    ADD CONSTRAINT gallery_gears_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY gallery_settings
    ADD CONSTRAINT gallery_settings_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY media_edit_files
    ADD CONSTRAINT media_edit_files_mediaid_foreign FOREIGN KEY ("mediaId") REFERENCES medias(id) ON DELETE CASCADE;

ALTER TABLE ONLY "oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_clientid_foreign FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId");

ALTER TABLE ONLY "oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_refreshid_foreign FOREIGN KEY ("refreshId") REFERENCES "oauthRefreshToken"(id);

ALTER TABLE ONLY "oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_sessionid_foreign FOREIGN KEY ("sessionId") REFERENCES sessions(id);

ALTER TABLE ONLY "oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_userid_foreign FOREIGN KEY ("userId") REFERENCES accounts(id);

ALTER TABLE ONLY "oauthClient"
    ADD CONSTRAINT oauthclient_userid_foreign FOREIGN KEY ("userId") REFERENCES accounts(id);

ALTER TABLE ONLY "oauthClientResource"
    ADD CONSTRAINT oauthclientresource_clientid_foreign FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE;

ALTER TABLE ONLY "oauthClientResource"
    ADD CONSTRAINT oauthclientresource_resourceid_foreign FOREIGN KEY ("resourceId") REFERENCES "oauthResource"(identifier) ON DELETE CASCADE;

ALTER TABLE ONLY "oauthConsent"
    ADD CONSTRAINT oauthconsent_clientid_foreign FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId");

ALTER TABLE ONLY "oauthConsent"
    ADD CONSTRAINT oauthconsent_userid_foreign FOREIGN KEY ("userId") REFERENCES accounts(id);

ALTER TABLE ONLY "oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_clientid_foreign FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId");

ALTER TABLE ONLY "oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_sessionid_foreign FOREIGN KEY ("sessionId") REFERENCES sessions(id);

ALTER TABLE ONLY "oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_userid_foreign FOREIGN KEY ("userId") REFERENCES accounts(id);

ALTER TABLE ONLY passkey
    ADD CONSTRAINT passkey_userid_foreign FOREIGN KEY ("userId") REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY status_pins
    ADD CONSTRAINT status_pins_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY status_pins
    ADD CONSTRAINT status_pins_statusid_foreign FOREIGN KEY ("statusId") REFERENCES statuses(id) ON DELETE CASCADE;

ALTER TABLE ONLY "twoFactor"
    ADD CONSTRAINT twofactor_userid_foreign FOREIGN KEY ("userId") REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY wahoo_history_imports
    ADD CONSTRAINT wahoo_history_imports_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY wahoo_imports
    ADD CONSTRAINT wahoo_imports_actorid_foreign FOREIGN KEY ("actorId") REFERENCES actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY wahoo_imports
    ADD CONSTRAINT wahoo_imports_fitnessfileid_foreign FOREIGN KEY ("fitnessFileId") REFERENCES fitness_files(id) ON DELETE SET NULL;

ALTER TABLE ONLY wahoo_imports
    ADD CONSTRAINT wahoo_imports_statusid_foreign FOREIGN KEY ("statusId") REFERENCES statuses(id) ON DELETE SET NULL;
