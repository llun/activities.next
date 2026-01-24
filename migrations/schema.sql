SET
    statement_timeout = 0;
SET
    lock_timeout = 0;
SET
    idle_in_transaction_session_timeout = 0;
SET
    transaction_timeout = 0;
SET
    client_encoding = 'UTF8';
SET
    standard_conforming_strings = on;
SELECT
    pg_catalog.set_config ('search_path', '', false);
SET
    check_function_bodies = false;
SET
    xmloption = content;
SET
    client_min_messages = warning;
SET
    row_security = off;
CREATE TABLE
    public.account_providers (
        id character varying(255) NOT NULL,
        "accountId" character varying(255),
        provider character varying(255),
        "providerId" character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.accounts (
        id character varying(255) NOT NULL,
        email character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "passwordHash" character varying(255),
            "verificationCode" character varying(255),
            "verifiedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.actors (
        id character varying(255),
        username character varying(255),
        "accountId" character varying(255),
        name character varying(255),
        summary text,
        "publicKey" text,
        "privateKey" text,
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            settings jsonb,
            domain character varying(255)
    );
CREATE TABLE
    public.attachments (
        id character varying(255) NOT NULL,
        "statusId" character varying(255),
        url character varying(255),
        "mediaType" character varying(255),
        type character varying(255),
        width integer,
        height integer,
        name text,
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "actorId" character varying(255)
    );
CREATE TABLE
    public.auth_codes (
        code character varying(255) NOT NULL,
        "redirectUri" character varying(255),
        "codeChallenge" character varying(255),
        "codeChallengeMethod" character varying(255),
        "clientId" character varying(255),
        "actorId" character varying(255),
        "accountId" character varying(255),
        scopes jsonb,
        "expiresAt" timestamp
        with
            time zone,
            "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.clients (
        id character varying(255) NOT NULL,
        name character varying(255),
        secret character varying(255),
        "redirectUris" text,
        scopes text,
        website character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.counters (
        id character varying(255) NOT NULL,
        value integer DEFAULT 0,
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.follows (
        id character varying(255) NOT NULL,
        "actorId" character varying(255),
        "actorHost" character varying(255),
        "targetActorId" character varying(255),
        "targetActorHost" character varying(255),
        status character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            inbox character varying(255),
            "sharedInbox" character varying(255)
    );
CREATE TABLE
    public.knex_migrations (
        id integer NOT NULL,
        name character varying(255),
        batch integer,
        migration_time timestamp
        with
            time zone
    );
CREATE SEQUENCE public.knex_migrations_id_seq AS integer
START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.knex_migrations_id_seq OWNED BY public.knex_migrations.id;
CREATE TABLE
    public.knex_migrations_lock (index integer NOT NULL, is_locked integer);
CREATE SEQUENCE public.knex_migrations_lock_index_seq AS integer
START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNED BY public.knex_migrations_lock.index;
CREATE TABLE
    public.likes (
        "statusId" character varying(255) NOT NULL,
        "actorId" character varying(255) NOT NULL,
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.medias (
        id integer NOT NULL,
        "actorId" character varying(255),
        original character varying(255),
        thumbnail character varying(255),
        description character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "accountId" character varying(255),
            "originalMimeType" character varying(255),
            "originalBytes" bigint,
            "thumbnailBytes" bigint,
            "thumbnailMimeType" character varying(255),
            "originalMetaData" jsonb,
            "thumbnailMetaData" jsonb,
            "originalFileName" character varying(255)
    );
CREATE SEQUENCE public.medias_id_seq AS integer
START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.medias_id_seq OWNED BY public.medias.id;
CREATE TABLE
    public.poll_answers (
        "answerId" integer NOT NULL,
        choice integer NOT NULL,
        "actorId" character varying(255) NOT NULL,
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE SEQUENCE public."poll_answers_answerId_seq" AS integer
START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public."poll_answers_answerId_seq" OWNED BY public.poll_answers."answerId";
CREATE TABLE
    public.poll_choices (
        "choiceId" integer NOT NULL,
        "statusId" character varying(255),
        title character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "totalVotes" integer DEFAULT 0 NOT NULL
    );
CREATE SEQUENCE public."poll_choices_choiceId_seq" AS integer
START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public."poll_choices_choiceId_seq" OWNED BY public.poll_choices."choiceId";
CREATE TABLE
    public.recipients (
        id character varying(255) NOT NULL,
        "statusId" character varying(255),
        "actorId" character varying(255),
        type character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.sessions (
        id character varying(255) NOT NULL,
        "accountId" character varying(255),
        token character varying(255),
        "expireAt" timestamp
        with
            time zone,
            "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.status_history (
        id integer NOT NULL,
        "statusId" character varying(255),
        data jsonb,
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE SEQUENCE public.status_history_id_seq AS integer
START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.status_history_id_seq OWNED BY public.status_history.id;
CREATE TABLE
    public.statuses (
        id character varying(255) NOT NULL,
        "actorId" character varying(255),
        type character varying(255),
        reply character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            content text
    );
CREATE TABLE
    public.tags (
        id character varying(255) NOT NULL,
        "statusId" character varying(255),
        type character varying(255),
        name character varying(255),
        value character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE
    public.timelines (
        id integer NOT NULL,
        "actorId" character varying(255),
        timeline character varying(255),
        "statusId" character varying(255),
        "statusActorId" character varying(255),
        "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
CREATE SEQUENCE public.timelines_id_seq AS integer
START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
ALTER SEQUENCE public.timelines_id_seq OWNED BY public.timelines.id;
CREATE TABLE
    public.tokens (
        "accessToken" character varying(255) NOT NULL,
        "refreshToken" character varying(255),
        "accessTokenExpiresAt" timestamp
        with
            time zone,
            "refreshTokenExpiresAt" timestamp
        with
            time zone,
            "clientId" character varying(255),
            "actorId" character varying(255),
            "accountId" character varying(255),
            scopes jsonb,
            "createdAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" timestamp
        with
            time zone DEFAULT CURRENT_TIMESTAMP
    );
ALTER TABLE ONLY public.account_providers
ADD CONSTRAINT "accountProviders_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public.accounts
ADD CONSTRAINT accounts_email_unique UNIQUE (email);
ALTER TABLE ONLY public.accounts
ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.actors
ADD CONSTRAINT actors_id_unique UNIQUE (id);
ALTER TABLE ONLY public.actors
ADD CONSTRAINT actors_username_domain_unique UNIQUE (username, domain);
ALTER TABLE ONLY public.clients
ADD CONSTRAINT applications_clientname_unique UNIQUE (name);
ALTER TABLE ONLY public.clients
ADD CONSTRAINT applications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.attachments
ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.auth_codes
ADD CONSTRAINT auth_codes_pkey PRIMARY KEY (code);
ALTER TABLE ONLY public.counters
ADD CONSTRAINT counters_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.follows
ADD CONSTRAINT follows_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.knex_migrations_lock
ADD CONSTRAINT knex_migrations_lock_pkey PRIMARY KEY (index);
ALTER TABLE ONLY public.knex_migrations
ADD CONSTRAINT knex_migrations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.likes
ADD CONSTRAINT likes_pkey PRIMARY KEY ("statusId", "actorId");
ALTER TABLE ONLY public.medias
ADD CONSTRAINT medias_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.poll_answers
ADD CONSTRAINT poll_answers_pkey PRIMARY KEY ("answerId");
ALTER TABLE ONLY public.poll_choices
ADD CONSTRAINT poll_choices_pkey PRIMARY KEY ("choiceId");
ALTER TABLE ONLY public.recipients
ADD CONSTRAINT recipients_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions
ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.status_history
ADD CONSTRAINT status_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.statuses
ADD CONSTRAINT statuses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tags
ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.timelines
ADD CONSTRAINT "timelines_actorId_timeline_statusId_unique" UNIQUE ("actorId", timeline, "statusId");
ALTER TABLE ONLY public.timelines
ADD CONSTRAINT timelines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.tokens
ADD CONSTRAINT tokens_pkey PRIMARY KEY ("accessToken");
CREATE INDEX "account_providers_accountId_provider_providerId_idx" ON public.account_providers USING btree ("accountId", provider, "providerId");
CREATE INDEX "accountsIndex" ON public.accounts USING btree (email, "createdAt", "updatedAt");
CREATE INDEX "actorsIndex" ON public.actors USING btree (username, "createdAt", "updatedAt");
CREATE INDEX "attachmentsIndex" ON public.attachments USING btree ("statusId", "createdAt", "updatedAt");
CREATE INDEX "attachments_actorId_idx" ON public.attachments USING btree ("actorId");
CREATE INDEX "countersIndex" ON public.counters USING btree (id, "createdAt", "updatedAt");
CREATE INDEX "followsIndex" ON public.follows USING btree ("actorId", "actorHost", "targetActorId", "targetActorHost", status, "createdAt", "updatedAt");
CREATE INDEX "medias_accountId_originalMimeType_idx" ON public.medias USING btree ("accountId", "originalMimeType");
CREATE INDEX "medias_actorId_originalMimeType_idx" ON public.medias USING btree ("actorId", "originalMimeType");
CREATE INDEX "recipiences_statusId_type_idx" ON public.recipients USING btree ("statusId", type, "createdAt", "updatedAt");
CREATE INDEX "recipientsTypeActorIdIndex" ON public.recipients USING btree (type, "actorId");
CREATE INDEX "sessions_accountId_token_idx" ON public.sessions USING btree ("accountId", token);
CREATE INDEX "status_history_statusId_idx" ON public.status_history USING btree ("statusId", "createdAt", "updatedAt");
CREATE INDEX "statusesReplyIndex" ON public.statuses USING btree (reply);
CREATE INDEX "statuses_actorId_idx" ON public.statuses USING btree ("actorId", "createdAt", "updatedAt");
CREATE INDEX "tags_statusId_type_idx" ON public.tags USING btree ("statusId", type, "createdAt", "updatedAt");
CREATE INDEX "timelinesActorIdTimelineCreatedAtIndex" ON public.timelines USING btree ("actorId", timeline, "createdAt");
CREATE INDEX "timelinesTimelineStatusIdIndex" ON public.timelines USING btree (timeline, "statusId");
CREATE INDEX "verificationCodeIndex" ON public.accounts USING btree ("verificationCode");
ALTER TABLE ONLY public.actors
ADD CONSTRAINT actors_accountid_foreign FOREIGN KEY ("accountId") REFERENCES public.accounts (id);
