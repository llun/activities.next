/**
 * Quote-post edges (FEP-044f / Mastodon 4.5). One row per quoting status
 * (a status may quote at most one other status — PK on statusId). Rows are
 * created for remote QuoteRequests BEFORE the quoting status row exists, so
 * there is intentionally no FK to statuses (matches likes/recipients/bookmarks).
 *
 * The stored `state` is only the five persistent states
 * (pending | accepted | rejected | revoked | deleted). The viewer-relative
 * states (unauthorized | blocked_account | blocked_domain | muted_account) are
 * computed at serialization time and never persisted.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = (knex) =>
  knex.schema.createTable('status_quotes', (table) => {
    table.string('statusId', 255).primary()
    table.string('quotedStatusId', 255).notNullable()
    table.string('state', 255).notNullable().defaultTo('pending')
    // The QuoteRequest activity id we sent (outbound) or received (inbound);
    // inbound Accept/Reject responses are matched against it.
    table.text('quoteRequestId').nullable()
    // The QuoteAuthorization stamp id once accepted (ours or theirs).
    table.text('authorizationUri').nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(
      ['quotedStatusId', 'state', 'createdAt'],
      'status_quotes_quoted_state_idx'
    )
    table.index(['authorizationUri'], 'status_quotes_authorization_idx')
  })

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = (knex) => knex.schema.dropTable('status_quotes')
