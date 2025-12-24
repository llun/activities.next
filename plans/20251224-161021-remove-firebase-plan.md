# Remove Firebase + Simplify DB Plan

- Inventory and classify Firebase usage: Firestore adapters, config flags, emulator scripts, tests, and docs.
- Refactor data layer to a single Knex-backed implementation: remove Firestore adapter and any branching by provider; keep a generic Knex repository interface.
- Eliminate provider-specific SQL: replace dialect-specific queries or raw SQL with Knex query builder patterns; standardize migrations and schema types.
- Simplify configuration: reduce config options to SQL backends (SQLite/Postgres/MySQL/compatible); keep one connection config shape with driver selection.
- Update tests/tooling/docs: remove Firebase test suites, emulator scripts, dependencies, and documentation; adjust test commands and setup.
