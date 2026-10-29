## docs/architecture.md lines 2711-2901

### Duplicates
- docs/architecture.md:2816 (`deleteSessionsWithTokenDetach`, `lib/database/domains/account/sessions.ts`) ≈ docs/maintenance.md:1278 — the session-delete helper and its token-detach rationale are explained in both files; one should link to the other.
- docs/architecture.md:2860 (soft `revoked` column not honoured, sign-out does not sign apps out) ≈ docs/maintenance.md session-delete guidance — same Mastodon-comparison rule restated across the two files.
- docs/architecture.md:2858 (`OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS`) — the sliding-expiry window and `database.extendOAuthAccessToken` mechanics overlap with the access-token guard descriptions elsewhere in this same file's OAuth sections (in-file duplication rather than cross-file).

### Stale
- none — spot-checked symbols against the repo and all exist (`schemaCompleteness.test.ts`, `errorURL.test.ts`, `kyselyAdapter*.ts`, `repointUnconfirmedAccountEmail`, `isAccountConfirmationPending`, `deleteSessionsWithTokenDetach`, `selectAccountActor`). No file paths, scripts, env vars or commands in this range were found missing.

### History / changelog text
- docs/architecture.md:2796 ("the better-auth 1.7 upgrade shipped a green suite while every OAuth sign-in 500'd") — war-story narrative of a past incident; the rule ("diff the declared schema") survives without it.
- docs/architecture.md:2826 (Database Joins section, long passage on 1.6.x behaviour: "the flag lived at `experimental.joins` until better-auth 1.7 moved it here… every signed-in user was silently logged out") — upgrade history, not a durable rule.
- docs/architecture.md:2858-2859 ("The pre-better-auth OAuth server's `tokens` table had a sliding session; the move to better-auth … dropped it") — migration history explaining why the slide exists; could compress to one sentence.
- docs/architecture.md:2896-2900 (Unconfirmed Account section, "round 6 moved it… that inversion was written here once and is what this sentence replaces") — self-referential changelog/meta commentary about earlier edits to this very doc.

### Long sections
- docs/architecture.md:2842-2863 `OAuth Access Token Sliding Expiry` (~12 bullets spanning into Auth Error Page heading at 2864) — dense but mostly durable rules; could split "guard/slide mechanics" from "revocation rules".
- docs/architecture.md:2876-2901 `OAuth Grants Must Resolve an Actor` — reference-table-free prose; bullets are individually durable but each runs 5-10 lines; splitting actor-resolution from app-token detection would help.

### Task/PR-specific
- docs/architecture.md:2811 ("Preflight the real database before a 1.7.3 rollout", "Drain and remove every 1.7.2 auth-serving instance", "route this as a coordinated cutover") — deployment-runbook steps for one release; the durable kernel (nullable `issuer`, duplicate `(provider, providerId)` check) is fine, the cutover sequencing belongs in the runbook the bullet itself points to.
- docs/architecture.md:2814 (Plan rollback separately; restore issuer values before handing traffic back) — same release-specific cutover plan.

### Readability
- Paragraph-bullets run 8-14 lines each (e.g. the schemaCompleteness bullet at 2796, the adapter-rules bullet at 2816, the re-point bullet at ~2897); a reader cannot scan the rule from the bold lead-in alone.
- Nested caveats inside caveats (parentheticals on parentheticals, e.g. the ProfileFieldsBlock "Where it shows" bullet at 2722-2735 and the re-point bullet) bury the operative rule; sub-bullets would fix it.
- Repeated "never/always" emphasis (bold **never**, *not*, caps NEVER) appears in nearly every bullet of the Auth Error Page and Sliding Expiry sections, diluting which rule is actually the hard one.

### Slice summary
Lines 2711-2901 are durable contributor rules for better-auth, OAuth grants, actor resolution, and the auth error page; almost nothing is disposable except the 1.7.3 cutover/rollback runbook text and two war-story passages (~15 lines total). No stale references were confirmed. The main defect is bullet length: single bullets carrying 10+ lines of mechanism, rationale and incident history that could be split into rule + note.
