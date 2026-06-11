### Handling Unique Constraint Violations

Pre-checks for uniqueness (e.g., checking if an email or username exists before an insert or update) are susceptible to Time-of-Check to Time-of-Use (TOCTOU) race conditions. Concurrent requests can bypass the pre-check and trigger a database unique constraint violation, which surfaces as a 500 Internal Server Error.

To handle this gracefully, wrap database operations that enforce unique constraints and catch specific unique constraint violation errors (e.g., using a helper like `isUniqueConstraintError`). Map these caught violations to a `422 Unprocessable Entity` response to provide a consistent, user-friendly error, rather than allowing the raw database error to propagate.