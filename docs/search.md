# Search

Activities.next keeps a SQL search index for accounts, public/unlisted statuses, and hashtags. The SQL index is the default search backend and is also the canonical source used to populate optional Meilisearch indexes.

## Indexed Data

- Accounts: username, domain, `username@domain`, display name, and profile summary.
- Statuses: public and unlisted `Note` and `Poll` text, summary, and hashtag names.
- Hashtags: hashtags attached to public or unlisted statuses.

Followers-only and direct status text is not indexed. `Announce` statuses are not indexed directly.

## Configuration

Database search is enabled by default:

```bash
ACTIVITIES_SEARCH_BACKEND=database
```

To use Meilisearch as the read backend:

```bash
ACTIVITIES_SEARCH_BACKEND=meilisearch
ACTIVITIES_SEARCH_MEILISEARCH_URL=https://search.example.com
ACTIVITIES_SEARCH_MEILISEARCH_API_KEY=your-api-key
ACTIVITIES_SEARCH_MEILISEARCH_INDEX_PREFIX=activities_next
ACTIVITIES_SEARCH_MEILISEARCH_TIMEOUT_MS=2000
```

If Meilisearch is configured but a search request fails, the server logs a warning and falls back to the SQL search index for that request.

## Account Fallback Search

Account search first uses the SQL search index. If the indexed account search returns no rows for the requested page, the server falls back to a bounded `LIKE` query over known actors so older instances can still find accounts before the search index has been rebuilt.

The fallback is intentionally not mixed into pages that already have indexed results. During partial hydration this can make account result ordering differ from the fallback query, so operators should run a SQL reindex after enabling search or after restoring/importing actor data.

## Rebuilding

Run migrations first:

```bash
yarn migrate
```

Rebuild the SQL index:

```bash
yarn search:reindex --backend database --clear
```

Preview the amount of data that would be indexed:

```bash
yarn search:reindex --backend database --dry-run
```

Populate Meilisearch from the SQL index:

```bash
ACTIVITIES_SEARCH_BACKEND=meilisearch yarn search:reindex --backend meilisearch --clear
```

Rebuild both SQL and Meilisearch:

```bash
ACTIVITIES_SEARCH_BACKEND=meilisearch yarn search:reindex --backend all --clear --batch-size 1000
```

Options:

- `--backend database|meilisearch|all`: selects the target backend. Defaults to `database`.
- `--clear`: clears existing target documents before writing new documents.
- `--batch-size <n>`: controls batch size. Defaults to `500`.
- `--dry-run`: prints counts without writing.

The Meilisearch mode refreshes the SQL search index first, then sends the SQL search documents to Meilisearch. This keeps Meilisearch hydrated with canonical IDs only; API responses are still hydrated from the SQL database before returning to clients.
