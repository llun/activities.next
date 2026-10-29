# Consult: astra

## Read of the problem

- The inventory measures roughly 1.6 MB of documentation; `docs/architecture.md` alone is 529 KB, and its contributor rules occupy lines 1139–4032. Operators and contributors must navigate different kinds of material in one file.
- This is mostly useful, current material presented badly, not obsolete documentation: the architecture, fitness, and Mastodon findings repeatedly describe accurate rules buried in long paragraphs.
- There are competing copies of rules: `CONTRIBUTING.md:1–706` and `707–1476` overlap; architecture's auth checks at 3564–3642 repeat 2889–2895; fitness's review sections at 1471–1556 repeat earlier basemap and heatmap guidance.
- `AGENTS.md:268–458` repeats routing instructions under approximately 48 headings, on top of its required-reading map. The extra navigation adds reading cost without supplying most rules.
- Line count understates the problem: `docs/features.md` is 64 KB in 158 lines, and the findings identify individual API and media bullets thousands of characters long.
- The reference inventory distinguishes one executable document dependency, `lib/config/envDocumentation.test.ts`, from comments and diagnostic strings. Passing CI therefore does not prove navigation or rule preservation.
- Some audit classifications need judgment: the Knex handover is still named by runtime migration messages, crash scenarios can be current correctness constraints, and the external `GearKit.jsx` reference is unverified rather than proven obsolete.
- The achievable improvement is one authoritative explanation per rule, short task entry points, and explicit links between them. Removing every repeated warning or every version reference would make the documentation less safe to use.

All ranges below refer to the audit baseline, `origin/main aa368a596`. Sizes are approximate decimal KB of Markdown content, not commitments to cut a fixed percentage. The audit files are research artifacts and are excluded from totals and proposed production documentation.

## Option 1: Edit in place (light tidy)

Keep every existing document and its present scope. Remove proven duplication within sections, break up paragraphs, repair false claims, and improve headings. Avoid changing where readers look for rules.

### Target file list

| File | Disposition and scope | Rough size after |
| --- | --- | ---: |
| `README.md` | Keep; simplify the Docker paragraph at 121 and make the first-run signup allow list explicit. Preserve the complete clone/install/configure/migrate/run/signup path. | 8 KB |
| `CONTRIBUTING.md` | Shorten; combine repeated test commands and CI descriptions, add subsections within Testing Guidelines, and shorten generic examples. Keep the contributor-reference structure for now. | 75 KB |
| `AGENTS.md` | Shorten; remove incident anecdotes and repeated prose, retain the topic headings and all policy details, and replace “moved to” with direct reading instructions. | 34 KB |
| `REVIEW.md` | Keep as the review entry point; simplify wording and verify every destination. | 10 KB |
| `LICENSE.md` | Keep the MIT text unchanged. | 1 KB |
| `.github/PULL_REQUEST_TEMPLATE.md` | Keep the actionable checklist and release instructions; simplify prose without dropping requirements. | 2 KB |
| `docs/architecture.md` | Shorten in place; subdivide account migration, previews, UI, and review sections; merge exact duplicate explanations while preserving anchors. | 420 KB |
| `docs/environment-variables.md` | Keep all variable entries; move paragraph-length cell explanations into nearby subsections, shorten the 11–129 preamble, and distinguish configuration semantics from admin UI detail. | 85 KB |
| `docs/features.md` | Keep as a concise current-feature guide; remove implementation inventories and the unimplemented roadmap checkbox at 152–154. | 35 KB |
| `docs/fitness-file-storage.md` | Shorten gear and heatmap prose, combine repeated cache explanations, and reduce the review duplicates to links after checking for unique clauses. | 150 KB |
| `docs/maintenance.md` | Shorten duplicate examples and incident accounts; retain usable upgrade/repair procedures and separate the current Media Sort Date Backfill from historical repairs. | 210 KB |
| `docs/mastodon-api-compatibility.md` | Keep public behavior and contributor rules; introduce endpoint-family headings within divergences and extensions, and shorten repeated migration stories. | 200 KB |
| `docs/setup.md` | Keep; clarify the user-created local database setup and divide command/lint/typecheck prose into readable sections. | 34 KB |
| `docs/quickstart.md` | Keep the focused minimal boot guide. | 4 KB |
| `docs/sqlite-setup.md` | Keep backend-specific paths, permissions, persistence, and deployment instructions. | 5 KB |
| `docs/postgresql-setup.md` | Keep backend-specific provisioning, grants, configuration, and deployment instructions. | 7 KB |
| `CLAUDE.md` | Restore the documented symlink to `AGENTS.md`, with no separate rule content. This is a future implementation change, not part of this consultation. | negligible |

**Total:** approximately **1.28 MB**, plausibly 1.2–1.4 MB after checking rule equivalence.

### Agent rules and reference compatibility

`AGENTS.md` retains the Definition of Done, complete delegation/model/effort policy, project structure including root tests in `test/`, runtime configuration, style/Tailwind, logging, and API response rules. It retains its generated Next.js block verbatim. The existing required-reading map and topic headings continue to route setup/database-local rules to `docs/setup.md`, implementation/UI/auth/email rules to architecture, protocol/visibility rules to Mastodon compatibility, fitness rules to fitness storage, security/storage/database rules to maintenance, and workflow/testing/design-library sync to CONTRIBUTING.

Keep existing paths and explicit `agents-*`/`review-*` anchors. When two sections merge, retain both identifiers at the surviving explanation. Keep ordinary heading anchors too when linked. Preserve the environment reference path and all required variable names; its test remains unchanged. Correct source comments, lint messages, and CI diagnostic destinations that already name the wrong location, including schema-dump guidance at `ci.yml:763,862`. Preserve the handover heading used by `baseline.ts:32` and `startupCheck.ts:30`.

### Outright removal and preservation check

Remove the deleted blurhash-backfill caller story at `maintenance.md:1167–1172`, PR-number provenance, dated benchmark anecdotes that add no rule, the dangling “epic plan” pointer at `mastodon-api-compatibility.md:1012–1013`, and the obsolete legacy-component count at `architecture.md:1509`. Keep the named-client-API rule and the prohibition on expanding its lint exemption list. Treat `GearKit.jsx` as an unresolved external-reference attribution to clarify, not a deletion candidate yet.

Do not delete whole documents. Do not delete upgrade eligibility, operator recovery instructions, supported legacy ID behavior, or the rule about frozen baseline files merely because they mention old releases. Keep short safety reminders next to commands even when their full explanation exists elsewhere.

For each edited section, compare its obligations, exceptions, rationale needed to interpret them, and validation guidance before and after. Record equivalence and unresolved items in the PR description, not a new document under `docs/`.

### Risks

Lowest navigation risk, but the root problem remains: architecture still approaches half a megabyte, and rules still have several full explanations. This option buys readability now without providing a strong defense against future duplication. Aggressive “stylistic” editing can still drop subtle exceptions.

### PRs and order

1. **Reference correctness:** fix confirmed stale claims, restore the documented symlink, clarify signup, and correct the placement of the current backfill.
2. **Entry points and workflow:** simplify root guides, feature overview, environment prose, and setup guides while retaining paths and anchors.
3. **Large reference guides:** edit architecture, maintenance, Mastodon compatibility, and fitness in place; reconcile every touched rule and reference.

## Option 2: One canonical explanation in the existing guides (recommended)

Consolidate content by responsibility without introducing a new documentation tree. Every topic has one full rule body; task instructions and review checklists link to it. This differs from Option 1 by removing competing rule copies and assigning ownership across files, not just shortening sentences.

### Target file list

| File | Disposition and scope | Rough size after |
| --- | --- | ---: |
| `README.md` | Keep a complete minimal first-run recipe with `ACTIVITIES_ALLOW_EMAILS`, a small feature overview, deployment choices, and an audience-based guide index. Receive the summary from features. | 9 KB |
| `CONTRIBUTING.md` | Merge its two halves into one contribution workflow: setup link, testing, recipes, design sync, documentation, release/PR rules, and review loop. Move the full dump recipe at 522–687 into setup's canonical database section. | 55 KB |
| `AGENTS.md` | Keep cross-cutting rules and orchestration policy; consolidate the repeated routing layers into one exhaustive topic-to-anchor index. Retain all special exceptions and the generated Next.js block. | 24 KB |
| `REVIEW.md` | Keep a short checklist with review questions and direct links to canonical rule bodies; remove explanatory copies. | 7 KB |
| `LICENSE.md` | Keep unchanged. | 1 KB |
| `.github/PULL_REQUEST_TEMPLATE.md` | Keep the release comment and completion checklist, with links to canonical procedures. | 2 KB |
| `docs/architecture.md` | Keep system flows, shared boundaries, runtime behavior, UI, auth, email, queues, archives, and previews. Integrate each rule's unique review checks into that topic; move detailed protocol, fitness, and stored-media contracts to their owners. | 280 KB |
| `docs/environment-variables.md` | Keep the complete variable catalog, defaults, validation, empty/unset semantics, precedence, and operational cautions; move detailed admin UI behavior to architecture and repair procedures to maintenance. | 65 KB |
| `docs/features.md` | Delete after merging its concise feature overview into README and moving any unique user-facing behavior to the owning existing guide. Remove planned-feature tracking. | 0 KB |
| `docs/fitness-file-storage.md` | Make it the single home for fitness data, maps, dates, privacy, gear, and their UI-specific contracts; fold the 1471–1556 review checks into the corresponding sections. | 105 KB |
| `docs/maintenance.md` | Own operator commands, supported upgrades/repairs, stored media/gallery behavior and security, and database compatibility invariants. Use an operator section followed by clearly indexed engineering sections. | 150 KB |
| `docs/mastodon-api-compatibility.md` | Own API request/response contracts, client IDs, visibility, JSON-LD/identity trust, and federation behavior. Move CSS/component layout mechanics at 1399–1686 to architecture; keep action eligibility here. | 145 KB |
| `docs/setup.md` | Own setup/deployment, command reference, local database safety, and the complete migration/dump/type-regeneration recipe. Receive unique procedure details from CONTRIBUTING. | 38 KB |
| `docs/quickstart.md` | Keep the intentionally minimal start path; align it with README, with advanced deployment details linked. | 4 KB |
| `docs/sqlite-setup.md` | Keep its focused backend role; link common app setup and command semantics. | 5 KB |
| `docs/postgresql-setup.md` | Keep its focused backend role; link common app setup and command semantics. | 7 KB |
| `CLAUDE.md` | Restore only the canonical symlink; no per-tool rule copy. | negligible |

**Total:** approximately **0.90 MB**, with a realistic planning range of **0.85–1.05 MB**. The 280 KB architecture target remains large; the gain is fewer repeated explanations and clear sections, not an artificially tiny architecture overview.

### Agent rules and canonical ownership

Keep universal obligations immediately visible in `AGENTS.md`: all seven DoD items, root-test placement, configuration boundaries, API response shape/CORS, logger/error handling, style/Tailwind, storage caution, and delegation requirements including model selection, effort escalation, verification, and fresh reviewers. Its model tables can be reformatted, but none of their task tiers, exceptions, or escalation rules disappear.

Use one complete reading index with these rule families:

- **Setup:** Node/Yarn, command behavior, optional workspaces, local-only database safety, migrations, both schema dumps, and generated DB types → `docs/setup.md`.
- **Workflow:** testing and harness exceptions, task recipes, conventional prefixes/versioning, PR review rounds and their unavailable-agent exception, docs maintenance, and the entire Sketch sync/regenerate/commit/push/publish workflow → `CONTRIBUTING.md`.
- **Architecture:** server/client boundaries, dates, client/outbound HTTP, runtime configuration detail, navigation and surfaces, layout/media presentation, settings, auth/OAuth, emails, previews, archives, jobs, PWA, and browser metrics → `docs/architecture.md`.
- **Protocol:** client IDs, Zod, JSON-LD, fetched identity, usernames/local actors, status visibility/action eligibility, and actor/status federation including Move/rename/delete → `docs/mastodon-api-compatibility.md`.
- **Fitness:** stat strips, basemaps, dates, heatmaps, gear, processing/storage/privacy → `docs/fitness-file-storage.md`.
- **Maintenance:** stored media/gallery semantics and deletion, untrusted filenames/URLs/path confinement, storage drivers, database/index compatibility, operational scripts, and supported upgrades → `docs/maintenance.md`.

Each individual existing rule topic gets a direct destination, not just six broad “read this entire guide” links. Preserve the section-navigation restriction presently repeated at `AGENTS.md:318`; it may become a short mandatory reminder plus a direct link, with its index-page exception in the canonical body. Keep review discovery through `REVIEW.md`, without maintaining a second full rulebook under “Review:” headings.

### Reference migration

Keep every existing file path except `docs/features.md`. Update every tracked incoming feature link to the new overview or the actual topic, rather than redirecting all of them to README's top. The audit reports zero broken doc anchors today; use that as the baseline to preserve, not proof the proposed changes will be safe.

For moved rule bodies, leave an explicit old anchor with a short link at the old location and update all in-repo consumers to the canonical destination in the same PR. When compressing AGENTS headings into an index, retain their old slug aliases beside index entries and update prose references in lint/source comments. A compatibility anchor contains a pointer, not a second explanation.

Keep `docs/environment-variables.md` and its full tested variable inventory; do not weaken `envDocumentation.test.ts` or pad the page with a names-only list to satisfy it. Keep defaults, units, precedence, and failure semantics intelligible as well as names present. Update CI's dump instructions to the canonical setup heading, including the PostgreSQL/SQLite normalization comments at `ci.yml:722,771`; keep Kysely type instructions reachable from its error at 879 and generated-file comments. Keep the handover heading and runtime references in maintenance.

### Outright removal and preservation check

Delete the feature checklist document only after a clause-level pass accounts for its unique behavior; its 152–154 roadmap item belongs in issue tracking, with no issue creation implied by this consultation. Keep intentional API non-support as reference: “Not planned” at `mastodon-api-compatibility.md:465–488` can become “Unsupported endpoints,” not disappear.

Merge duplicated content deliberately: schema dumps in CONTRIBUTING/setup; Move/rename behavior in architecture/API compatibility; media query contracts in maintenance/API compatibility; heatmap/gear descriptions in architecture/fitness; auth rule/review pairs in architecture. Decide the owner of a specific claim, then replace the other full copy with a short contextual link. Different audiences can retain a short summary and command-local warning.

Remove Option 1's proven stale references, incident timelines, abandoned task pointers, and redundant implementations/examples. Do not equate headings beginning “Review:” with disposable content: the audit finds the final Mastodon review slice largely unique. Preserve current failure modes, counterexamples, ordering constraints, numeric limits, recovery steps, and exceptions, even when originally explained through a past bug. Keep supported Knex upgrades and historical-data repair eligibility; there is no evidence all deployed databases have passed them.

Maintain a before/after rule ledger in each PR description: old location, obligation plus exceptions, canonical destination, and disposition (unchanged/reworded/duplicate/stale). A duplicate needs a matching surviving clause; a stale claim needs source evidence. Every old rule must have a destination. Review high-risk auth, visibility, federation, storage, and migrator changes by meaning rather than by word count. Size targets yield to preservation.

### Risks

Semantic consolidation requires more care than reformatting: similarly worded rules may differ by route, viewer, driver, or failure state. Architecture and maintenance remain substantial mixed-audience guides, so prominent contents lists and separate operator/engineering sections matter. Deleting features may break external bookmarks even after all repository links are updated. Root guide summaries and aliases still require maintenance, but their explanations have one owner.

### PRs and order

1. **Correctness baseline:** fix the stale legacy-fetch claim and deleted-script story, repair backfill placement, restore the documented symlink, and make README signup self-contained; keep rule ownership and paths stable.
2. **Workflow and discovery:** consolidate CONTRIBUTING, AGENTS routing, REVIEW, and the PR template; make setup the canonical dump/type workflow and update affected diagnostics/links atomically.
3. **Architecture and protocol:** consolidate UI/auth/archives/previews and API/federation/visibility rules, preserving unique review checks and old anchor aliases.
4. **Operations and fitness:** consolidate maintenance, fitness, environment settings, and backend guides, retaining all supported upgrade paths and security exceptions.
5. **Landing and feature retirement:** transfer any remaining unique feature behavior, delete `docs/features.md`, update incoming links, and run the final cross-guide rule/reference audit.

## Option 3: Separate operator guides and domain engineering references (deep restructure)

Perform semantic consolidation, then split long guides by stable domain. The aim is shorter targeted reading, not the smallest aggregate byte count. Introduce only durable references; no design proposals, review reports, or change-specific plans enter `docs/`.

### Target file list

| File | Disposition and scope | Rough size after |
| --- | --- | ---: |
| `README.md` | Keep the complete minimal first-run recipe, feature overview, and guide map; receive quickstart. | 9 KB |
| `CONTRIBUTING.md` | Shorten to the contribution journey, release/PR/review workflow, and links to testing, development, and design-sync references. | 14 KB |
| `AGENTS.md` | Keep universal rules and the full orchestration policy; use a complete domain reading index plus old-topic aliases. | 24 KB |
| `REVIEW.md` | Keep the review checklist, now linked directly to domain references. | 7 KB |
| `LICENSE.md` | Keep unchanged. | 1 KB |
| `.github/PULL_REQUEST_TEMPLATE.md` | Keep the linked checklist and release requirements. | 2 KB |
| `docs/architecture.md` | Split; keep system context, boundaries, request-flow diagrams, and a domain map. Preserve old anchors as links. | 18 KB |
| `docs/maintenance.md` | Split; keep operational commands, upgrade/repair procedures, and links to domain safety requirements. Preserve handover guidance at its current path/heading. | 60 KB |
| `docs/mastodon-api-compatibility.md` | Split; keep public API contracts, divergence and unsupported-endpoint reference; move federation internals to federation. | 75 KB |
| `docs/fitness-file-storage.md` | Split; keep upload/storage/import/processing/privacy foundations; move maps and gear detail to dedicated guides. | 40 KB |
| `docs/environment-variables.md` | Keep the complete tested variable catalog, configuration semantics, and operational cautions. | 65 KB |
| `docs/setup.md` | Shorten to installation and deployment; move engineering commands and database-generation procedures to their new homes, retaining old aliases. | 30 KB |
| `docs/quickstart.md` | Merge into README and delete; replace tracked incoming links with README's first-run anchor. | 0 KB |
| `docs/features.md` | Merge overview into README and unique feature detail into domain guides, then delete. | 0 KB |
| `docs/sqlite-setup.md` | Keep focused SQLite provisioning/deployment instructions. | 5 KB |
| `docs/postgresql-setup.md` | Keep focused PostgreSQL provisioning/deployment instructions. | 7 KB |
| `docs/development.md` | New durable command/tooling/local-environment guide, sourced from setup and CONTRIBUTING. | 25 KB |
| `docs/testing.md` | New durable harness, mocks, isolation, dates, PostgreSQL, browser testing, and known-failure reference from CONTRIBUTING:713–1150. | 35 KB |
| `docs/design-library-sync.md` | New durable home for the complete Sketch library/screens/prototype workflow from CONTRIBUTING:1198–1213. | 8 KB |
| `docs/ui.md` | New shared UI contract: client boundaries, dates, chrome, surfaces, settings, media/action presentation, previews, and offline behavior from architecture and compatibility. | 90 KB |
| `docs/auth.md` | New auth/OAuth/verification/session/served-domain identity reference from architecture's auth and review sections. | 45 KB |
| `docs/federation.md` | New JSON-LD, signatures, fetched-identity trust, visibility, Move/rename/delete, and interop engineering reference from architecture and compatibility. | 90 KB |
| `docs/account-archives.md` | New export/import, resumability, leases, storage lifecycle, and recovery reference from architecture:379–777 and maintenance's duplicated internals. | 55 KB |
| `docs/media.md` | New stored-media/gallery/deletion/driver-parity/path-security reference from architecture and maintenance:995–1221,1530–1710. | 100 KB |
| `docs/database.md` | New migrator/baseline/dumps/types/backend/index/transaction/idempotency engineering reference from setup, CONTRIBUTING, and maintenance. | 40 KB |
| `docs/fitness-heatmaps.md` | New map-provider/tile-pyramid/privacy/cache/acceptance reference from fitness:102–265,518–924,1471–1556 and architecture's heatmap copies. | 35 KB |
| `docs/fitness-gear.md` | New gear identity/import/matching/UI contract from fitness:266–300,925–1470 and the corresponding architecture duplicates. | 45 KB |
| `CLAUDE.md` | Restore only the symlink to the canonical AGENTS entry point. | negligible |

**Total:** approximately **1.03 MB**, plausibly 0.95–1.15 MB. This can be larger than Option 2 because each focused guide needs context and task entry points; the benefit is smaller reading units. It adds eleven domain/workflow guides and deletes two overlapping entry documents.

### Agent reachability

Keep the complete root obligations listed in Option 2. Each task row in AGENTS points directly to every applicable domain guide; a cross-domain task must read all applicable rows. Map engineering commands to development, tests to testing, schema/dumps/types to database, design changes to UI plus design-library-sync, authentication to auth, protocol/visibility to federation plus API compatibility, media/security to media, and fitness work to fitness storage plus heatmaps/gear as applicable. Keep jobs/queue/email/observability rules in explicit indexed sections of architecture; archives get their own guide. Keep commit/review/docs-maintenance rules in CONTRIBUTING.

The root DoD still explicitly requires the separate Sketch repository's updates, regeneration, commit, push, and publication. Moving detailed instructions does not weaken this obligation or its failure disclosure. Preserve the generated Next.js block and the sub-agent policy's full model/effort/exception semantics.

### Reference migration

Maintain the environment catalog at its existing path, with the existing test unchanged. For retained files, old explicit and linked heading anchors become short compatibility links to new canonical sections. Update AGENTS, REVIEW, all doc links, approximately 111 non-Markdown reference hits, lint messages, and CI instructions in the same PR that moves the referenced material. Distinguish real references from fixture strings such as `scripts/README.md` in the lint test.

Move dump/type instructions to `docs/database.md` and update CI, migrator stub, generator documentation/header source, and related comments together; verify generated headers stay consistent. Keep operator handover messages correct by leaving that procedure in maintenance. Deleting quickstart/features breaks unknown external links; call this out explicitly in the retirement PR rather than claiming complete backward compatibility. All known repository links must resolve.

### Outright removal and preservation check

Remove the same proven stale claims, obsolete planning references, redundant rule copies, and nonessential historical narrative as Option 2. Delete only quickstart and features after mapping their complete useful content. Retain the focused backend guides and license; their small size is not a reason to merge them.

Use Option 2's clause ledger before splitting, then add a source-section-to-destination map for each move in the PR description. Do not split a rule's exception or its necessary recovery instructions away from the rule itself. Runtime behavior, public API contract, operator command, and review entry point may each have a short contextual reference, but must identify the same authoritative technical contract.

### Risks

Highest reference churn and reading-map complexity. Eleven new guides create boundary questions: UI versus domain-specific behavior, API contract versus federation implementation, and database rules versus maintenance procedures. Simple relocation would only distribute the current bloat, so semantic consolidation is still necessary. Long-lived alias sections add some maintenance cost. This option is justified if bounded domain reading is a priority beyond the cleanup itself.

### PRs and order

1. **Correctness baseline:** apply Option 2's first PR without moving rule bodies.
2. **Contributor workflow split:** consolidate workflow content, create development/testing/design-sync guides, and update their incoming references atomically.
3. **Architecture split:** create UI/auth/account-archives guides, consolidate duplicate rule/review bodies, and retain architecture as a system map plus remaining shared-service rules.
4. **Protocol split:** create federation, separate public API contracts, and update identity/visibility/federation references together.
5. **Storage/database split:** create media/database, make maintenance operator-focused, and update CI/generator/source guidance in the same change.
6. **Fitness split:** create heatmap/gear guides, preserve processing/privacy rules, and update architecture and maintenance links.
7. **Entry-point retirement:** merge quickstart/features, delete them, finish root navigation, and validate all paths, anchors, and rule-family routes.

## Recommendation

Choose **Option 2: one canonical explanation in the existing guides**. The audit demonstrates duplicate content and poor structure much more clearly than it demonstrates a need for eleven new files. Consolidation gives the largest useful reduction with moderate reference churn, removes a genuinely redundant feature checklist, and preserves the small operator guides that already work. Option 1 leaves too much competing guidance; Option 3 is reasonable later if the consolidated guides still impede domain-specific reading.

Start with **the correctness-baseline PR**, keeping ownership and paths stable: fix architecture's stale legacy-fetch claim while retaining the no-exemption rule, remove the deleted blurhash-script story while retaining the URL/storage security requirements, move the current Media Sort Date Backfill out of the historical-repairs group, restore the documented CLAUDE symlink, and name the signup allow-list variable in README's working recipe. Preserve the Knex handover and unresolved external design-kit reference until their actual obligations are resolved. This produces a small, concrete review before the semantic consolidations.

For every implementation PR, use a feature branch and the required ordered gate: `yarn run prettier --write .` → `yarn lint` → `yarn typecheck` → `yarn build` → `yarn test`. Also check document paths/anchors, source and diagnostic references, environment-variable semantics, rule-ledger completeness, and the README first-run procedure against an isolated local setup. The current CI has no documentation link check, and the environment test checks name presence rather than semantic accuracy. Follow the repository review process when implementing; this consultation itself is read-only research except for this one output file, with no formatting, build, commit, push, or production-document changes performed.
