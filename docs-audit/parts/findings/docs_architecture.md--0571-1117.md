## docs/architecture.md lines 571-1117

### Duplicates
- docs/architecture.md:571-677 (Account data import) ≈ docs/features.md:69 — the import rules (10 GiB cap, 200,000-entry ZIP cap, one import per profile, three starts per 24h, `reply-uri-too-long`, quiet-import exceptions) are restated nearly verbatim in features.md's "Account archive import" bullet.
- docs/architecture.md:806-866 (Route Heatmap Tiles) ≈ docs/fitness-file-storage.md:136,203,758,865 — `buildHeatmapTileSource` gating, tile pyramid and clip-on-serve rules are explained in both files (fitness-file-storage.md carries the fuller version).

### Stale
none — spot-checked identifiers (`MAX_TILES_PER_REQUEST`, `ACTIVITIES_WEB_VITALS_SAMPLE_RATE`, `ACTIVITIES_WEB_VITALS_MAX_REPORTS_PER_MINUTE`, `ACTIVITIES_ACCOUNT_IMPORT_MAX_FILE_SIZE`, `proxyClientMaxBodySize`, `lib/utils/jpegExif.ts`, `lib/services/webVitals/schema.ts`, `scripts/maintenance/cleanupMediaStorage.ts`, `test/proxy.test.ts`): all exist.

### History / changelog text
- docs/architecture.md:811-813 — "A fitness route heatmap used to be one pre-simplified blob... `fitness_route_heatmap_pyramids` and `fitness_route_heatmap_tiles` replace it" — narrative of a past design ("used to", "replace it"); the durable rule is just the current pyramid design.
- docs/architecture.md:819-820 — "It still renders every row the pyramid cannot answer" and "The stored blob has not gone away" — migration-era framing; could state the fallback role directly.
- docs/architecture.md:790 — "(1 MiB of unclosed `<div>`s blocked the event loop for seconds)" — war-story rationale; the rule ("use the Tokenizer, not a tree parse") stands without it.

### Long sections
- docs/architecture.md:571-677 `#### Records, phases and recovery` + `#### Archive and document bounds` + `#### Quiet writes and imported data` (Account data import, ~207 lines total) — dense but reference-like; the skip-reason list (lines 640-660) and reason-code paragraphs could move to a table.
- docs/architecture.md:868-1046 `### Media & File Storage` (~179 lines) — one section covering upload routes, thumbnails, photo edits, masks, prune races and storage usage; could be split (upload path vs edit lifecycle) or trimmed of nested caveat chains.
- docs/architecture.md:1051-1062 `### Browser Web Vitals` (~12 bullet lines but ~450+ words) — single-paragraph bullets (Sending, Privacy allowlist) are walls of text; sub-bullets would help.
- docs/architecture.md:1063-1117 `## Database Schema (Simplified)` (55 lines) — ASCII diagram plus "Other tables" list; reference tables that must stay, though the retired-collection caveat at the end could live nearer the schema tables it concerns.

### Task/PR-specific
- docs/architecture.md:1047-1049 — "Offline-First PWA Launch & Timeline Caching" section body is a single self-pointer ("See [Offline-First PWA Launch & Timeline Caching](#agents-offline-first-pwa-launch-timeline-caching)") whose anchor does not resolve to a section inside this slice's file range; reads like a stub left from a section move.

### Readability
- docs/architecture.md:884-1046 — Media & File Storage paragraphs run 10-20 lines with multi-clause sentences ("Whatever fails after the first write reclaims what it stored, because a `medias` row is the only handle..."); nested caveat chains are hard to scan.
- docs/architecture.md:911-935 — the four "surfaces read the pyramid" bullets mix auth, caching, renderer fallback and format opt-in in one bullet each.

### Slice summary
Lines 571-1117 cover account data import, link preview cards, route heatmap tiles, media & file storage, and web vitals collection. Content is current and reference-quality; the main issues are extreme section length (Media & File Storage ~179 lines, Account data import ~207), walls-of-text paragraphs, and near-verbatim duplication of the import rules and heatmap rules in features.md and fitness-file-storage.md.
