## docs/environment-variables.md lines 1-267

### Duplicates
- docs/environment-variables.md:135 ≈ docs/quickstart.md:66, docs/setup.md:48 — secret generation instruction "Generate with `openssl rand -base64 32`" stated in three places (quickstart and setup both repeat it near the `ACTIVITIES_SECRET_PHASE` requirement).
- docs/environment-variables.md:63-73 ≈ docs/architecture.md:1198 — the `posts.maxMediaAttachments` exception (no route enforces it; the three create/edit paths fall back to the fixed `MAX_STORED_MEDIA_ATTACHMENTS` ceiling, answering 422) is restated nearly in full in architecture.md, which itself says "See Database-backed server settings in docs/environment-variables.md for the full explanation" — the duplication is a deliberate cross-reference but the content is still in both.
- docs/environment-variables.md:66 ≈ docs/architecture.md:1195 — "client UI reads resolved limits through `useInstanceLimits()`" appears in both (brief mention here, full consumer list in architecture.md).

### Stale
- none — all env var names, symbols and paths in the slice were checked against code and exist: `scripts/database/migrate.ts` (git ls-files), `"migrate"` package.json script (package.json:22), `MAX_STORED_MEDIA_ATTACHMENTS` (`lib/services/mastodon/constants`, used in app/), `useInstanceLimits` (`lib/components/instance-limits`), `validateStatusContentLimits` (`lib/services/statuses/contentLimits`), `ACTIVITIES_TRUSTED_HOSTS`, `ACTIVITIES_EMAIL_SES_REGION`, `ACTIVITIES_EMAIL_RESEND_TOKEN`, `ACTIVITIES_MEDIA_STORAGE_PATH`, `ACTIVITIES_DATABASE_PG_SSL_MODE`, `X-Activity-Next-Host`, `translation_cache` table, and `ACTIVITIES_INSECURE_AUTH`, `ACTIVITIES_REQUEST_TIMEOUT/RETRY/MAX_RESPONSE_SIZE_BYTES`, `ACTIVITIES_FITNESS_MAP_PROVIDER`, `ACTIVITIES_ALLOW_MEDIA_DOMAINS`, `ACTIVITIES_SECRET_PHASE`, `ACTIVITIES_TRANSLATION_PLAN`, `ACTIVITIES_ALT_TEXT_ENDPOINT`, `ACTIVITIES_DATABASE_PG_POOL_MAX` (all found via `git grep -n <VAR> -- lib app scripts`). Per the brief, `ACTIVITIES_DATABASE_MYSQL_*` "no longer read" (line 185) is a claim about removed vars, not a stale reference in this doc.

### History / changelog text
- docs/environment-variables.md:9 — "Root-level `config.json` files are ignored; migrate any previous file settings" — one-time migration instruction left in durable reference.
- docs/environment-variables.md:207 — "including the removed `lambda` provider" — narrative of a past removal.
- docs/environment-variables.md:209-211 — "Before upgrading an instance that used Lambda, migrate its configuration to SMTP, Resend, or AWS SES" — one-time migration instruction, not durable reference.
- docs/environment-variables.md:185 — "are no longer read, by the app or by `yarn migrate`" — "no longer" framing; the durable rule (unsupported clients fail at startup) is already stated in the same sentence.

### Long sections
- docs/environment-variables.md:11-129 `## Database-backed server settings (env → database → default)` (119 lines) — prose block, mostly admin-UI behavior (badges, which tabs show what, the `.env` builder). Could be split: the env-var precedence rule is reference; the admin-form/builder walkthrough reads like app documentation and duplicates what architecture.md covers. Not tables, so shorten or move.

### Task/PR-specific
- docs/environment-variables.md:209-211 — Lambda-to-SMTP/Resend/SES migration instruction for a past provider removal (one-time).

### Readability
- docs/environment-variables.md:139-143 — `ACTIVITIES_SERVICE_NAME`, `ACTIVITIES_PRIVACY_POLICY`, `ACTIVITIES_TERMS_OF_SERVICE` table cells are 100-200+ word walls inside markdown table rows, with nested parentheticals; nearly unreadable as a reference table.
- docs/environment-variables.md:34-46 — the endpoint-enforcement paragraph packs route lists, error-message wording differences ("which just says it is out of range", "says `Invalid image file`") into one sentence chain; API-error detail that buries the section's actual rule.
- docs/environment-variables.md:106-122 — the "Configure environment" builder paragraph chains five caveats (inert, restart required, example-vs-value, `./uploads` default distinction, optional-var omission) in continuous prose.
- docs/environment-variables.md:174-181 — `ACTIVITIES_DATABASE_PG_POOL_MAX` cell mixes default, deployment advice, JSON-config interaction and validation rules in one cell.

### Slice summary
Reference document for env vars, lines 1-267 covering the precedence preamble, core/proxy/database/auth/email/translation/alt-text sections. No stale references found — everything checks out against code. The main cleanup targets: the 119-line admin-behavior prose block (lines 11-129, much of it belongs in architecture/admin docs), the Lambda migration remnants, and three walls-of-text table cells.
