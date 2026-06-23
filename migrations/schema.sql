SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE TABLE public.account_notes (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "actorHost" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "targetActorHost" character varying(255) NOT NULL,
    comment text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.account_providers (
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
    scope text
);

CREATE TABLE public.accounts (
    id character varying(255) NOT NULL,
    email character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "passwordHash" character varying(255),
    "verificationCode" character varying(255),
    "verifiedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
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
    "twoFactorEnabled" boolean DEFAULT false NOT NULL
);

CREATE TABLE public.actors (
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
    type character varying(255) DEFAULT 'Person'::character varying NOT NULL
);

CREATE TABLE public.announcement_reactions (
    "announcementId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.announcement_reads (
    "announcementId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.announcements (
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

CREATE TABLE public.attachments (
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
    "mediaId" integer
);

CREATE TABLE public.auth_codes (
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

CREATE TABLE public.blocks (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "actorHost" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "targetActorHost" character varying(255) NOT NULL,
    uri character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.bookmarks (
    id bigint NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "sourceStatusId" character varying(255)
);

CREATE SEQUENCE public.bookmarks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.bookmarks_id_seq OWNED BY public.bookmarks.id;

CREATE TABLE public.clients (
    id character varying(255) NOT NULL,
    name character varying(255),
    secret character varying(255),
    "redirectUris" text,
    scopes text,
    website character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.collection_members (
    seq bigint NOT NULL,
    id character varying(255) NOT NULL,
    "collectionSeq" bigint NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "featureState" character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.collection_members_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.collection_members_seq_seq OWNED BY public.collection_members.seq;

CREATE TABLE public.collection_timeline (
    id bigint NOT NULL,
    "collectionSeq" bigint NOT NULL,
    "memberSeq" bigint NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "sortKey" bigint NOT NULL
);

CREATE SEQUENCE public.collection_timeline_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.collection_timeline_id_seq OWNED BY public.collection_timeline.id;

CREATE TABLE public.collections (
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
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.collections_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.collections_seq_seq OWNED BY public.collections.seq;

CREATE TABLE public.counters (
    id text NOT NULL,
    value bigint DEFAULT '0'::bigint NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "bucketHour" timestamp with time zone
);

CREATE TABLE public."customEmojis" (
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

CREATE TABLE public.direct_conversation_memberships (
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

CREATE SEQUENCE public.direct_conversation_memberships_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.direct_conversation_memberships_id_seq OWNED BY public.direct_conversation_memberships.id;

CREATE TABLE public.direct_conversation_participants (
    id character varying(255) NOT NULL,
    "conversationId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.direct_conversation_statuses (
    "conversationId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.direct_conversations (
    id character varying(255) NOT NULL,
    "rootStatusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.domain_federation_rules (
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

CREATE TABLE public.endorsements (
    id integer NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "actorHost" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "targetActorHost" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.endorsements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.endorsements_id_seq OWNED BY public.endorsements.id;

CREATE TABLE public.featured_tags (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "nameNormalized" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.federated_timeline (
    "statusId" character varying(255) NOT NULL,
    "statusActorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.filter_keywords (
    id character varying(255) NOT NULL,
    "filterId" character varying(255) NOT NULL,
    keyword text NOT NULL,
    "wholeWord" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.filter_statuses (
    id character varying(255) NOT NULL,
    "filterId" character varying(255) NOT NULL,
    "statusId" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.filters (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    context text NOT NULL,
    "filterAction" character varying(255) DEFAULT 'warn'::character varying NOT NULL,
    "expiresAt" bigint,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.fitness_files (
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
    "sourceUrl" text
);

CREATE TABLE public.fitness_route_heatmap_region_names (
    "actorId" character varying(255) NOT NULL,
    region character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.fitness_route_heatmaps (
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
    "totalCount" integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.fitness_settings (
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
    "defaultVisibility" character varying(255)
);

CREATE TABLE public.followed_tags (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    name character varying(255) NOT NULL,
    "nameNormalized" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.follows (
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

CREATE TABLE public.idempotency_keys (
    "actorId" character varying(255) NOT NULL,
    key character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.instance_rules (
    id character varying(255) NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    text text NOT NULL,
    hint text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.jwks (
    id character varying(255) NOT NULL,
    "publicKey" text NOT NULL,
    "privateKey" text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp with time zone
);

CREATE TABLE public.knex_migrations (
    id integer NOT NULL,
    name character varying(255),
    batch integer,
    migration_time timestamp with time zone
);

CREATE SEQUENCE public.knex_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.knex_migrations_id_seq OWNED BY public.knex_migrations.id;

CREATE TABLE public.knex_migrations_lock (
    index integer NOT NULL,
    is_locked integer
);

CREATE SEQUENCE public.knex_migrations_lock_index_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNED BY public.knex_migrations_lock.index;

CREATE TABLE public.legacy_fitness_heatmap_media_cleanup (
    "actorId" character varying(255) NOT NULL,
    "imagePath" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "deletedAt" timestamp with time zone,
    error text
);

CREATE TABLE public.likes (
    "statusId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.list_accounts (
    id character varying(255) NOT NULL,
    "listId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.lists (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    "repliesPolicy" character varying(255) DEFAULT 'list'::character varying NOT NULL,
    exclusive boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.markers (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    timeline character varying(255) NOT NULL,
    "lastReadId" text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.medias (
    id integer NOT NULL,
    "actorId" character varying(255),
    original character varying(255),
    thumbnail character varying(255),
    description character varying(255),
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
    "focusY" double precision
);

CREATE SEQUENCE public.medias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.medias_id_seq OWNED BY public.medias.id;

CREATE TABLE public.mutes (
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

CREATE TABLE public.notifications (
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
    filtered boolean DEFAULT false NOT NULL
);

CREATE TABLE public."oauthAccessToken" (
    id character varying(255) NOT NULL,
    token text NOT NULL,
    "clientId" character varying(255) NOT NULL,
    "sessionId" character varying(255),
    "userId" character varying(255),
    "referenceId" character varying(255),
    "refreshId" character varying(255),
    "expiresAt" timestamp with time zone NOT NULL,
    scopes text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public."oauthClient" (
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
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public."oauthConsent" (
    id character varying(255) NOT NULL,
    "clientId" character varying(255) NOT NULL,
    "userId" character varying(255),
    "referenceId" character varying(255),
    scopes text NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public."oauthRefreshToken" (
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
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.passkey (
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

CREATE TABLE public.poll_answers (
    "answerId" integer NOT NULL,
    choice integer NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "statusId" character varying(255) NOT NULL
);

CREATE SEQUENCE public."poll_answers_answerId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."poll_answers_answerId_seq" OWNED BY public.poll_answers."answerId";

CREATE TABLE public.poll_choices (
    "choiceId" integer NOT NULL,
    "statusId" character varying(255),
    title character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "totalVotes" integer DEFAULT 0 NOT NULL
);

CREATE SEQUENCE public."poll_choices_choiceId_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public."poll_choices_choiceId_seq" OWNED BY public.poll_choices."choiceId";

CREATE TABLE public.poll_voters (
    id integer NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.poll_voters_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.poll_voters_id_seq OWNED BY public.poll_voters.id;

CREATE TABLE public.push_subscriptions (
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

CREATE TABLE public.recipients (
    id character varying(255) NOT NULL,
    "statusId" character varying(255),
    "actorId" character varying(255),
    type character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.relays (
    id character varying(255) NOT NULL,
    "inboxUrl" character varying(255) NOT NULL,
    "actorId" character varying(255),
    state character varying(255) DEFAULT 'idle'::character varying NOT NULL,
    "followActivityId" character varying(255),
    "lastError" text,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.reports (
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
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.scheduled_statuses (
    id character varying(255) NOT NULL,
    "actorId" character varying(255) NOT NULL,
    "scheduledAt" timestamp with time zone NOT NULL,
    params text NOT NULL,
    "createdAt" timestamp with time zone NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.search_documents (
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

CREATE TABLE public.server_filter_keywords (
    id character varying(255) NOT NULL,
    "filterId" character varying(255) NOT NULL,
    keyword text NOT NULL,
    "wholeWord" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.server_filters (
    id character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    context text NOT NULL,
    "filterAction" character varying(255) DEFAULT 'warn'::character varying NOT NULL,
    "expiresAt" bigint,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.sessions (
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

CREATE TABLE public.status_history (
    id integer NOT NULL,
    "statusId" character varying(255),
    data jsonb,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.status_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.status_history_id_seq OWNED BY public.status_history.id;

CREATE TABLE public.status_mutes (
    "actorId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.status_pins (
    "actorId" character varying(255) NOT NULL,
    "statusId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.statuses (
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
    "applicationWebsite" character varying(255)
);

CREATE TABLE public.strava_archive_imports (
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

CREATE TABLE public.suggestion_dismissals (
    "actorId" character varying(255) NOT NULL,
    "targetActorId" character varying(255) NOT NULL,
    "createdAt" timestamp with time zone NOT NULL
);

CREATE TABLE public.tags (
    id character varying(255) NOT NULL,
    "statusId" character varying(255),
    type character varying(255),
    name character varying(255),
    value character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "nameNormalized" character varying(255)
);

CREATE TABLE public.timelines (
    id integer NOT NULL,
    "actorId" character varying(255),
    timeline character varying(255),
    "statusId" character varying(255),
    "statusActorId" character varying(255),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE public.timelines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.timelines_id_seq OWNED BY public.timelines.id;

CREATE TABLE public.tokens (
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

CREATE TABLE public.translation_cache (
    provider character varying(191) NOT NULL,
    "sourceLanguage" character varying(16) NOT NULL,
    "targetLanguage" character varying(16) NOT NULL,
    "sourceHash" character varying(64) NOT NULL,
    content text NOT NULL,
    "detectedSourceLanguage" character varying(16),
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public."twoFactor" (
    id character varying(255) NOT NULL,
    secret text NOT NULL,
    "backupCodes" text NOT NULL,
    "userId" character varying(255) NOT NULL,
    verified boolean DEFAULT false NOT NULL
);

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp with time zone NOT NULL,
    "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE ONLY public.bookmarks ALTER COLUMN id SET DEFAULT nextval('public.bookmarks_id_seq'::regclass);

ALTER TABLE ONLY public.collection_members ALTER COLUMN seq SET DEFAULT nextval('public.collection_members_seq_seq'::regclass);

ALTER TABLE ONLY public.collection_timeline ALTER COLUMN id SET DEFAULT nextval('public.collection_timeline_id_seq'::regclass);

ALTER TABLE ONLY public.collections ALTER COLUMN seq SET DEFAULT nextval('public.collections_seq_seq'::regclass);

ALTER TABLE ONLY public.direct_conversation_memberships ALTER COLUMN id SET DEFAULT nextval('public.direct_conversation_memberships_id_seq'::regclass);

ALTER TABLE ONLY public.endorsements ALTER COLUMN id SET DEFAULT nextval('public.endorsements_id_seq'::regclass);

ALTER TABLE ONLY public.knex_migrations ALTER COLUMN id SET DEFAULT nextval('public.knex_migrations_id_seq'::regclass);

ALTER TABLE ONLY public.knex_migrations_lock ALTER COLUMN index SET DEFAULT nextval('public.knex_migrations_lock_index_seq'::regclass);

ALTER TABLE ONLY public.medias ALTER COLUMN id SET DEFAULT nextval('public.medias_id_seq'::regclass);

ALTER TABLE ONLY public.poll_answers ALTER COLUMN "answerId" SET DEFAULT nextval('public."poll_answers_answerId_seq"'::regclass);

ALTER TABLE ONLY public.poll_choices ALTER COLUMN "choiceId" SET DEFAULT nextval('public."poll_choices_choiceId_seq"'::regclass);

ALTER TABLE ONLY public.poll_voters ALTER COLUMN id SET DEFAULT nextval('public.poll_voters_id_seq'::regclass);

ALTER TABLE ONLY public.status_history ALTER COLUMN id SET DEFAULT nextval('public.status_history_id_seq'::regclass);

ALTER TABLE ONLY public.timelines ALTER COLUMN id SET DEFAULT nextval('public.timelines_id_seq'::regclass);

ALTER TABLE ONLY public.account_providers
    ADD CONSTRAINT "accountProviders_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public.account_notes
    ADD CONSTRAINT account_notes_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY public.account_notes
    ADD CONSTRAINT account_notes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_email_unique UNIQUE (email);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_id_unique UNIQUE (id);

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_username_domain_unique UNIQUE (username, domain);

ALTER TABLE ONLY public.announcement_reactions
    ADD CONSTRAINT announcement_reactions_pkey PRIMARY KEY ("announcementId", "actorId", name);

ALTER TABLE ONLY public.announcement_reads
    ADD CONSTRAINT announcement_reads_pkey PRIMARY KEY ("announcementId", "actorId");

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT applications_clientname_unique UNIQUE (name);

ALTER TABLE ONLY public.clients
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.auth_codes
    ADD CONSTRAINT auth_codes_pkey PRIMARY KEY (code);

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_uri_unique UNIQUE (uri);

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_actor_status_unique UNIQUE ("actorId", "statusId");

ALTER TABLE ONLY public.bookmarks
    ADD CONSTRAINT bookmarks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.collection_members
    ADD CONSTRAINT collection_members_collection_target_unique UNIQUE ("collectionSeq", "targetActorId");

ALTER TABLE ONLY public.collection_members
    ADD CONSTRAINT collection_members_id_unique UNIQUE (id);

ALTER TABLE ONLY public.collection_members
    ADD CONSTRAINT collection_members_pkey PRIMARY KEY (seq);

ALTER TABLE ONLY public.collection_timeline
    ADD CONSTRAINT collection_timeline_collection_status_unique UNIQUE ("collectionSeq", "statusId");

ALTER TABLE ONLY public.collection_timeline
    ADD CONSTRAINT collection_timeline_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_id_unique UNIQUE (id);

ALTER TABLE ONLY public.collections
    ADD CONSTRAINT collections_pkey PRIMARY KEY (seq);

ALTER TABLE ONLY public.counters
    ADD CONSTRAINT counters_tmp_new_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public."customEmojis"
    ADD CONSTRAINT "customEmojis_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."customEmojis"
    ADD CONSTRAINT customemojis_shortcode_unique UNIQUE (shortcode);

ALTER TABLE ONLY public.direct_conversation_memberships
    ADD CONSTRAINT direct_conversation_memberships_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.direct_conversation_participants
    ADD CONSTRAINT direct_conversation_participants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.direct_conversation_statuses
    ADD CONSTRAINT direct_conversation_statuses_pkey PRIMARY KEY ("conversationId", "statusId");

ALTER TABLE ONLY public.direct_conversations
    ADD CONSTRAINT direct_conversations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.direct_conversation_memberships
    ADD CONSTRAINT direct_membership_actor_conversation UNIQUE ("actorId", "conversationId");

ALTER TABLE ONLY public.direct_conversation_participants
    ADD CONSTRAINT direct_participant_conversation_actor UNIQUE ("conversationId", "actorId");

ALTER TABLE ONLY public.domain_federation_rules
    ADD CONSTRAINT domain_federation_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.domain_federation_rules
    ADD CONSTRAINT domain_federation_rules_type_domain_unique UNIQUE (type, domain);

ALTER TABLE ONLY public.endorsements
    ADD CONSTRAINT endorsements_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY public.endorsements
    ADD CONSTRAINT endorsements_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.featured_tags
    ADD CONSTRAINT featured_tags_actor_name_unique UNIQUE ("actorId", "nameNormalized");

ALTER TABLE ONLY public.featured_tags
    ADD CONSTRAINT featured_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.federated_timeline
    ADD CONSTRAINT federated_timeline_pkey PRIMARY KEY ("statusId");

ALTER TABLE ONLY public.filter_keywords
    ADD CONSTRAINT filter_keywords_filter_keyword_unique UNIQUE ("filterId", keyword);

ALTER TABLE ONLY public.filter_keywords
    ADD CONSTRAINT filter_keywords_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.filter_statuses
    ADD CONSTRAINT filter_statuses_filter_status_unique UNIQUE ("filterId", "statusId");

ALTER TABLE ONLY public.filter_statuses
    ADD CONSTRAINT filter_statuses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.filters
    ADD CONSTRAINT filters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fitness_files
    ADD CONSTRAINT fitness_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fitness_route_heatmap_region_names
    ADD CONSTRAINT fitness_route_heatmap_region_names_pkey PRIMARY KEY ("actorId", region);

ALTER TABLE ONLY public.fitness_route_heatmaps
    ADD CONSTRAINT fitness_route_heatmaps_actorid_activitytypekey_periodtype_perio UNIQUE ("actorId", "activityTypeKey", "periodType", "periodKey", region);

ALTER TABLE ONLY public.fitness_route_heatmaps
    ADD CONSTRAINT fitness_route_heatmaps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fitness_settings
    ADD CONSTRAINT fitness_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.followed_tags
    ADD CONSTRAINT followed_tags_actor_name_unique UNIQUE ("actorId", "nameNormalized");

ALTER TABLE ONLY public.followed_tags
    ADD CONSTRAINT followed_tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.follows
    ADD CONSTRAINT follows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY ("actorId", key);

ALTER TABLE ONLY public.instance_rules
    ADD CONSTRAINT instance_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.jwks
    ADD CONSTRAINT jwks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.knex_migrations_lock
    ADD CONSTRAINT knex_migrations_lock_pkey PRIMARY KEY (index);

ALTER TABLE ONLY public.knex_migrations
    ADD CONSTRAINT knex_migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.legacy_fitness_heatmap_media_cleanup
    ADD CONSTRAINT legacy_fitness_heatmap_media_cleanup_pkey PRIMARY KEY ("actorId", "imagePath");

ALTER TABLE ONLY public.likes
    ADD CONSTRAINT likes_pkey PRIMARY KEY ("statusId", "actorId");

ALTER TABLE ONLY public.list_accounts
    ADD CONSTRAINT list_accounts_list_target_unique UNIQUE ("listId", "targetActorId");

ALTER TABLE ONLY public.list_accounts
    ADD CONSTRAINT list_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lists
    ADD CONSTRAINT lists_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.markers
    ADD CONSTRAINT markers_actor_timeline_unique UNIQUE ("actorId", timeline);

ALTER TABLE ONLY public.markers
    ADD CONSTRAINT markers_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.medias
    ADD CONSTRAINT medias_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mutes
    ADD CONSTRAINT mutes_actor_target_unique UNIQUE ("actorId", "targetActorId");

ALTER TABLE ONLY public.mutes
    ADD CONSTRAINT mutes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public."oauthAccessToken"
    ADD CONSTRAINT "oauthAccessToken_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."oauthClient"
    ADD CONSTRAINT "oauthClient_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."oauthConsent"
    ADD CONSTRAINT "oauthConsent_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."oauthRefreshToken"
    ADD CONSTRAINT "oauthRefreshToken_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_token_unique UNIQUE (token);

ALTER TABLE ONLY public."oauthClient"
    ADD CONSTRAINT oauthclient_clientid_unique UNIQUE ("clientId");

ALTER TABLE ONLY public."oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_token_unique UNIQUE (token);

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_credentialid_unique UNIQUE ("credentialID");

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.poll_answers
    ADD CONSTRAINT poll_answers_pkey PRIMARY KEY ("answerId");

ALTER TABLE ONLY public.poll_choices
    ADD CONSTRAINT poll_choices_pkey PRIMARY KEY ("choiceId");

ALTER TABLE ONLY public.poll_voters
    ADD CONSTRAINT poll_voters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.poll_voters
    ADD CONSTRAINT poll_voters_statusid_actorid_unique UNIQUE ("statusId", "actorId");

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint);

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.recipients
    ADD CONSTRAINT recipients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.relays
    ADD CONSTRAINT relays_inboxurl_unique UNIQUE ("inboxUrl");

ALTER TABLE ONLY public.relays
    ADD CONSTRAINT relays_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.scheduled_statuses
    ADD CONSTRAINT scheduled_statuses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_documents
    ADD CONSTRAINT search_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.server_filter_keywords
    ADD CONSTRAINT server_filter_keywords_filter_keyword_unique UNIQUE ("filterId", keyword);

ALTER TABLE ONLY public.server_filter_keywords
    ADD CONSTRAINT server_filter_keywords_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.server_filters
    ADD CONSTRAINT server_filters_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.status_history
    ADD CONSTRAINT status_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.status_mutes
    ADD CONSTRAINT status_mutes_pkey PRIMARY KEY ("actorId", "statusId");

ALTER TABLE ONLY public.status_pins
    ADD CONSTRAINT status_pins_pkey PRIMARY KEY ("actorId", "statusId");

ALTER TABLE ONLY public.statuses
    ADD CONSTRAINT statuses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.strava_archive_imports
    ADD CONSTRAINT strava_archive_imports_archiveid_unique UNIQUE ("archiveId");

ALTER TABLE ONLY public.strava_archive_imports
    ADD CONSTRAINT strava_archive_imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.suggestion_dismissals
    ADD CONSTRAINT suggestion_dismissals_pkey PRIMARY KEY ("actorId", "targetActorId");

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.timelines
    ADD CONSTRAINT "timelines_actorId_timeline_statusId_unique" UNIQUE ("actorId", timeline, "statusId");

ALTER TABLE ONLY public.timelines
    ADD CONSTRAINT timelines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.tokens
    ADD CONSTRAINT tokens_pkey PRIMARY KEY ("accessToken");

ALTER TABLE ONLY public.translation_cache
    ADD CONSTRAINT translation_cache_pkey PRIMARY KEY (provider, "sourceLanguage", "targetLanguage", "sourceHash");

ALTER TABLE ONLY public."twoFactor"
    ADD CONSTRAINT "twoFactor_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."twoFactor"
    ADD CONSTRAINT twofactor_userid_unique UNIQUE ("userId");

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);

CREATE INDEX "account_providers_accountId_provider_providerId_idx" ON public.account_providers USING btree ("accountId", provider, "providerId");

CREATE INDEX "accountsIndex" ON public.accounts USING btree (email, "createdAt", "updatedAt");

CREATE INDEX "actorsIndex" ON public.actors USING btree (username, "createdAt", "updatedAt");

CREATE INDEX "actors_accountId_idx" ON public.actors USING btree ("accountId");

CREATE INDEX "attachmentsIndex" ON public.attachments USING btree ("statusId", "createdAt", "updatedAt");

CREATE INDEX "attachments_actorId_idx" ON public.attachments USING btree ("actorId");

CREATE INDEX "attachments_mediaId_idx" ON public.attachments USING btree ("mediaId");

CREATE INDEX blocks_actor_created ON public.blocks USING btree ("actorId", "createdAt");

CREATE INDEX blocks_target ON public.blocks USING btree ("targetActorId");

CREATE INDEX bookmarks_actor_created_id ON public.bookmarks USING btree ("actorId", "createdAt", id);

CREATE INDEX bookmarks_actor_source_status ON public.bookmarks USING btree ("actorId", "sourceStatusId");

CREATE INDEX bookmarks_status ON public.bookmarks USING btree ("statusId");

CREATE INDEX collection_members_target ON public.collection_members USING btree ("targetActorId");

CREATE INDEX collection_timeline_member ON public.collection_timeline USING btree ("memberSeq");

CREATE INDEX collection_timeline_read ON public.collection_timeline USING btree ("collectionSeq", "sortKey");

CREATE INDEX collection_timeline_status ON public.collection_timeline USING btree ("statusId");

CREATE INDEX collections_owner_created ON public.collections USING btree ("ownerActorId", "createdAt");

CREATE INDEX "countersIndex" ON public.counters USING btree (id, "createdAt", "updatedAt");

CREATE INDEX counters_bucket_hour_index ON public.counters USING btree ("bucketHour");

CREATE INDEX direct_conversation_status ON public.direct_conversation_statuses USING btree ("statusId");

CREATE INDEX direct_conversation_statuses_order ON public.direct_conversation_statuses USING btree ("conversationId", "createdAt", "statusId");

CREATE INDEX direct_conversations_root_status ON public.direct_conversations USING btree ("rootStatusId");

CREATE INDEX direct_membership_actor_visible ON public.direct_conversation_memberships USING btree ("actorId", "hiddenAt", "lastStatusCreatedAt", id);

CREATE INDEX direct_membership_last_status ON public.direct_conversation_memberships USING btree ("lastStatusId");

CREATE INDEX direct_participant_actor ON public.direct_conversation_participants USING btree ("actorId");

CREATE INDEX domain_federation_rules_source_idx ON public.domain_federation_rules USING btree (source);

CREATE INDEX domain_federation_rules_type_idx ON public.domain_federation_rules USING btree (type, "createdAt");

CREATE INDEX featured_tags_name ON public.featured_tags USING btree ("nameNormalized");

CREATE INDEX federated_timeline_status_actor_id ON public.federated_timeline USING btree ("statusActorId");

CREATE INDEX filter_keywords_filter_id ON public.filter_keywords USING btree ("filterId");

CREATE INDEX filter_statuses_filter_id ON public.filter_statuses USING btree ("filterId");

CREATE INDEX filters_actor_created ON public.filters USING btree ("actorId", "createdAt");

CREATE INDEX fitness_files_actor_created_idx ON public.fitness_files USING btree ("actorId", "createdAt");

CREATE INDEX fitness_files_actor_id_idx ON public.fitness_files USING btree ("actorId");

CREATE INDEX fitness_files_import_batch_id_idx ON public.fitness_files USING btree ("importBatchId");

CREATE INDEX fitness_files_status_id_idx ON public.fitness_files USING btree ("statusId");

CREATE INDEX fitness_route_heatmaps_actorid_periodtype_index ON public.fitness_route_heatmaps USING btree ("actorId", "periodType");

CREATE INDEX fitness_route_heatmaps_actorid_status_index ON public.fitness_route_heatmaps USING btree ("actorId", status);

CREATE INDEX fitness_settings_idx ON public.fitness_settings USING btree ("actorId", "serviceType", "deletedAt");

CREATE UNIQUE INDEX fitness_settings_unique_active ON public.fitness_settings USING btree ("actorId", "serviceType") WHERE ("deletedAt" IS NULL);

CREATE INDEX fitness_settings_webhook_token_idx ON public.fitness_settings USING btree ("webhookToken");

CREATE INDEX followed_tags_name ON public.followed_tags USING btree ("nameNormalized");

CREATE INDEX "followsIndex" ON public.follows USING btree ("actorId", "actorHost", "targetActorId", "targetActorHost", status, "createdAt", "updatedAt");

CREATE INDEX idempotency_keys_created ON public.idempotency_keys USING btree ("createdAt");

CREATE INDEX idempotency_keys_status ON public.idempotency_keys USING btree ("statusId");

CREATE INDEX list_accounts_target ON public.list_accounts USING btree ("targetActorId");

CREATE INDEX lists_actor_created ON public.lists USING btree ("actorId", "createdAt");

CREATE INDEX "medias_accountId_originalMimeType_idx" ON public.medias USING btree ("accountId", "originalMimeType");

CREATE INDEX "medias_actorId_createdAt_idx" ON public.medias USING btree ("actorId", "createdAt");

CREATE INDEX "medias_actorId_originalMimeType_idx" ON public.medias USING btree ("actorId", "originalMimeType");

CREATE INDEX mutes_actor_created ON public.mutes USING btree ("actorId", "createdAt");

CREATE INDEX mutes_target ON public.mutes USING btree ("targetActorId");

CREATE INDEX notifications_actor_created ON public.notifications USING btree ("actorId", "createdAt");

CREATE INDEX notifications_actor_filtered ON public.notifications USING btree ("actorId", filtered, "createdAt");

CREATE INDEX notifications_actor_unread ON public.notifications USING btree ("actorId", "isRead", "createdAt");

CREATE INDEX notifications_follow_id ON public.notifications USING btree ("followId");

CREATE INDEX notifications_group_key ON public.notifications USING btree ("groupKey", "createdAt");

CREATE INDEX notifications_status_id ON public.notifications USING btree ("statusId");

CREATE INDEX oauth_client_reference_id_idx ON public."oauthClient" USING btree ("referenceId");

CREATE INDEX passkey_userid_index ON public.passkey USING btree ("userId");

CREATE INDEX passkey_userid_rpid_index ON public.passkey USING btree ("userId", "rpID");

CREATE INDEX "passwordResetCodeIndex" ON public.accounts USING btree ("passwordResetCode");

CREATE INDEX poll_answers_statusid_actorid_index ON public.poll_answers USING btree ("statusId", "actorId");

CREATE INDEX poll_voters_statusid_index ON public.poll_voters USING btree ("statusId");

CREATE INDEX push_subscriptions_actor_idx ON public.push_subscriptions USING btree ("actorId");

CREATE INDEX "recipiences_statusId_type_idx" ON public.recipients USING btree ("statusId", type, "createdAt", "updatedAt");

CREATE INDEX "recipientsTypeActorIdIndex" ON public.recipients USING btree (type, "actorId");

CREATE INDEX "recipients_actorId_statusId_idx" ON public.recipients USING btree ("actorId", "statusId");

CREATE INDEX recipients_type_actor_created_status_idx ON public.recipients USING btree (type, "actorId", "createdAt", "statusId");

CREATE INDEX relays_actor_id ON public.relays USING btree ("actorId");

CREATE INDEX relays_state ON public.relays USING btree (state);

CREATE INDEX reports_actor_created ON public.reports USING btree ("actorId", "createdAt");

CREATE INDEX reports_target ON public.reports USING btree ("targetActorId");

CREATE INDEX scheduled_statuses_actorid_index ON public.scheduled_statuses USING btree ("actorId");

CREATE INDEX scheduled_statuses_scheduledat_index ON public.scheduled_statuses USING btree ("scheduledAt");

CREATE INDEX search_documents_actor ON public.search_documents USING btree ("actorId");

CREATE INDEX search_documents_document_text_fts ON public.search_documents USING gin (to_tsvector('simple'::regconfig, "documentText"));

CREATE INDEX search_documents_entity_created ON public.search_documents USING btree ("entityCreatedAt");

CREATE INDEX search_documents_entity_type_entity_id ON public.search_documents USING btree ("entityType", "entityId");

CREATE INDEX search_documents_last_post ON public.search_documents USING btree ("lastPostAt");

CREATE INDEX search_documents_post_count ON public.search_documents USING btree ("postCount");

CREATE INDEX server_filter_keywords_filter_id ON public.server_filter_keywords USING btree ("filterId");

CREATE INDEX server_filters_created ON public.server_filters USING btree ("createdAt");

CREATE INDEX server_filters_expires_at ON public.server_filters USING btree ("expiresAt");

CREATE INDEX "sessions_accountId_token_idx" ON public.sessions USING btree ("accountId", token);

CREATE INDEX "status_history_statusId_idx" ON public.status_history USING btree ("statusId", "createdAt", "updatedAt");

CREATE INDEX status_mutes_status ON public.status_mutes USING btree ("statusId");

CREATE INDEX status_pins_actor_created_status ON public.status_pins USING btree ("actorId", "createdAt", "statusId");

CREATE INDEX status_pins_status ON public.status_pins USING btree ("statusId");

CREATE INDEX "statusesReplyHashIndex" ON public.statuses USING btree ("replyHash");

CREATE INDEX "statusesReplyIndex" ON public.statuses USING btree (reply);

CREATE INDEX "statusesUrlHashIndex" ON public.statuses USING btree ("urlHash");

CREATE INDEX "statuses_actorId_idx" ON public.statuses USING btree ("actorId", "createdAt", "updatedAt");

CREATE INDEX statuses_announce_actor_original_idx ON public.statuses USING btree (type, "actorId", "originalStatusId");

CREATE INDEX statuses_reply_type_idx ON public.statuses USING btree (reply, type);

CREATE UNIQUE INDEX strava_archive_imports_actor_active_idx ON public.strava_archive_imports USING btree ("actorId") WHERE ("resolvedAt" IS NULL);

CREATE INDEX strava_archive_imports_actor_status_idx ON public.strava_archive_imports USING btree ("actorId", status);

CREATE INDEX strava_archive_imports_batch_id_idx ON public.strava_archive_imports USING btree ("batchId");

CREATE INDEX "tags_nameNormalized_type_idx" ON public.tags USING btree ("nameNormalized", type);

CREATE INDEX "tags_statusId_type_idx" ON public.tags USING btree ("statusId", type, "createdAt", "updatedAt");

CREATE INDEX "timelinesActorIdTimelineCreatedAtIndex" ON public.timelines USING btree ("actorId", timeline, "createdAt");

CREATE INDEX "timelinesActorTimelineStatusActorIndex" ON public.timelines USING btree ("actorId", timeline, "statusActorId");

CREATE INDEX "timelinesStatusIdIndex" ON public.timelines USING btree ("statusId");

CREATE INDEX translation_cache_created ON public.translation_cache USING btree ("createdAt");

CREATE INDEX "verificationCodeIndex" ON public.accounts USING btree ("verificationCode");

CREATE INDEX verification_identifier_index ON public.verification USING btree (identifier);

ALTER TABLE ONLY public.actors
    ADD CONSTRAINT actors_accountid_foreign FOREIGN KEY ("accountId") REFERENCES public.accounts(id);

ALTER TABLE ONLY public.federated_timeline
    ADD CONSTRAINT federated_timeline_statusid_foreign FOREIGN KEY ("statusId") REFERENCES public.statuses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fitness_files
    ADD CONSTRAINT fitness_files_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fitness_files
    ADD CONSTRAINT fitness_files_statusid_foreign FOREIGN KEY ("statusId") REFERENCES public.statuses(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.fitness_route_heatmap_region_names
    ADD CONSTRAINT fitness_route_heatmap_region_names_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fitness_route_heatmaps
    ADD CONSTRAINT fitness_route_heatmaps_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);

ALTER TABLE ONLY public.fitness_settings
    ADD CONSTRAINT fitness_settings_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id);

ALTER TABLE ONLY public."oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_clientid_foreign FOREIGN KEY ("clientId") REFERENCES public."oauthClient"("clientId");

ALTER TABLE ONLY public."oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_refreshid_foreign FOREIGN KEY ("refreshId") REFERENCES public."oauthRefreshToken"(id);

ALTER TABLE ONLY public."oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_sessionid_foreign FOREIGN KEY ("sessionId") REFERENCES public.sessions(id);

ALTER TABLE ONLY public."oauthAccessToken"
    ADD CONSTRAINT oauthaccesstoken_userid_foreign FOREIGN KEY ("userId") REFERENCES public.accounts(id);

ALTER TABLE ONLY public."oauthClient"
    ADD CONSTRAINT oauthclient_userid_foreign FOREIGN KEY ("userId") REFERENCES public.accounts(id);

ALTER TABLE ONLY public."oauthConsent"
    ADD CONSTRAINT oauthconsent_clientid_foreign FOREIGN KEY ("clientId") REFERENCES public."oauthClient"("clientId");

ALTER TABLE ONLY public."oauthConsent"
    ADD CONSTRAINT oauthconsent_userid_foreign FOREIGN KEY ("userId") REFERENCES public.accounts(id);

ALTER TABLE ONLY public."oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_clientid_foreign FOREIGN KEY ("clientId") REFERENCES public."oauthClient"("clientId");

ALTER TABLE ONLY public."oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_sessionid_foreign FOREIGN KEY ("sessionId") REFERENCES public.sessions(id);

ALTER TABLE ONLY public."oauthRefreshToken"
    ADD CONSTRAINT oauthrefreshtoken_userid_foreign FOREIGN KEY ("userId") REFERENCES public.accounts(id);

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_userid_foreign FOREIGN KEY ("userId") REFERENCES public.accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.status_pins
    ADD CONSTRAINT status_pins_actorid_foreign FOREIGN KEY ("actorId") REFERENCES public.actors(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.status_pins
    ADD CONSTRAINT status_pins_statusid_foreign FOREIGN KEY ("statusId") REFERENCES public.statuses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public."twoFactor"
    ADD CONSTRAINT twofactor_userid_foreign FOREIGN KEY ("userId") REFERENCES public.accounts(id) ON DELETE CASCADE;

