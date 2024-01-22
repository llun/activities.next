/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => {
  return knex.schema
    .alterTable('timelines', function (table) {
      table.dropUnique(
        ['actorId', 'timeline', 'statusId'],
        'actor_timeline_status'
      )
      table.unique(['actorId', 'timeline', 'statusId'], {
        indexName: 'timelines_actorId_timeline_statusId_unique'
      })
    })
    .alterTable('account_providers', function (table) {
      table.dropIndex(
        ['accountId', 'provider', 'providerId'],
        'accountProvidersIndex'
      )
      table.index(
        ['accountId', 'provider', 'providerId'],
        'account_providers_accountId_provider_providerId_idx'
      )
    })
    .alterTable('recipients', function (table) {
      table.dropIndex(
        ['statusId', 'type', 'createdAt', 'updatedAt'],
        'recipientsIndex'
      )
      table.index(
        ['statusId', 'type', 'createdAt', 'updatedAt'],
        'recipiences_statusId_type_idx'
      )
    })
    .alterTable('sessions', function (table) {
      table.dropIndex(['accountId', 'token'], 'sessionTokenIndex')
      table.index(['accountId', 'token'], 'sessions_accountId_token_idx')
    })
    .alterTable('status_history', function (table) {
      table.dropIndex(
        ['statusId', 'createdAt', 'updatedAt'],
        'statusHistoryIndex'
      )
      table.index(
        ['statusId', 'createdAt', 'updatedAt'],
        'status_history_statusId_idx'
      )
    })
    .alterTable('statuses', function (table) {
      table.dropIndex(['actorId', 'createdAt', 'updatedAt'], 'statusesIndex')
      table.index(['actorId', 'createdAt', 'updatedAt'], 'statuses_actorId_idx')
    })
    .alterTable('tags', function (table) {
      table.dropIndex(
        ['statusId', 'type', 'createdAt', 'updatedAt'],
        'tagsIndex'
      )
      table.index(
        ['statusId', 'type', 'createdAt', 'updatedAt'],
        'tags_statusId_type_idx'
      )
    })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => {
  return knex.schema
    .alterTable('timelines', function (table) {
      table.unique(['actorId', 'timeline', 'statusId'], {
        indexName: 'actor_timeline_status'
      })
      table.dropUnique(
        ['actorId', 'timeline', 'statusId'],
        'timelines_actorId_timeline_statusId_unique'
      )
    })
    .alterTable('account_providers', function (table) {
      table.dropIndex(
        ['accountId', 'provider', 'providerId'],
        'account_providers_accountId_provider_providerId_idx'
      )
      table.index(
        ['accountId', 'provider', 'providerId'],
        'accountProvidersIndex'
      )
    })
    .alterTable('recipients', function (table) {
      table.dropIndex(
        ['statusId', 'type', 'createdAt', 'updatedAt'],
        'recipiences_statusId_type_idx'
      )
      table.index(
        ['statusId', 'type', 'createdAt', 'updatedAt'],
        'recipientsIndex'
      )
    })
    .alterTable('sessions', function (table) {
      table.dropIndex(['accountId', 'token'], 'sessions_accountId_token_idx')
      table.index(['accountId', 'token'], 'sessionTokenIndex')
    })
    .alterTable('status_history', function (table) {
      table.dropIndex(
        ['statusId', 'createdAt', 'updatedAt'],
        'status_history_statusId_idx'
      )
      table.index(['statusId', 'createdAt', 'updatedAt'], 'statusHistoryIndex')
    })
    .alterTable('statuses', function (table) {
      table.dropIndex(
        ['actorId', 'createdAt', 'updatedAt'],
        'statuses_actorId_idx'
      )
      table.index(['actorId', 'createdAt', 'updatedAt'], 'statusesIndex')
    })
    .alterTable('tags', function (table) {
      table.dropIndex(
        ['statusId', 'type', 'createdAt', 'updatedAt'],
        'tags_statusId_type_idx'
      )
      table.index(['statusId', 'type', 'createdAt', 'updatedAt'], 'tagsIndex')
    })
}
