const crypto = require('crypto')

const parseStatusContent = (content) => {
  if (!content) return null
  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    } catch {
      return null
    }
  }
  if (typeof content === 'object') {
    return content
  }
  return null
}

const getStatusUrlHash = (url) =>
  crypto.createHash('sha256').update(url).digest('hex')

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasUrlColumn = await knex.schema.hasColumn('statuses', 'url')
  if (!hasUrlColumn) {
    await knex.schema.alterTable('statuses', function (table) {
      table.text('url').nullable()
    })
  }

  const hasUrlHashColumn = await knex.schema.hasColumn('statuses', 'urlHash')
  if (!hasUrlHashColumn) {
    await knex.schema.alterTable('statuses', function (table) {
      table.string('urlHash', 64).nullable()
      table.index('urlHash', 'statusesUrlHashIndex')
    })
  }

  const statuses = await knex('statuses').select(
    'id',
    'content',
    'url',
    'urlHash'
  )
  for (const status of statuses) {
    const content = parseStatusContent(status.content)
    const contentUrl =
      content && typeof content.url === 'string' && content.url.length > 0
        ? content.url
        : null
    const nextUrl =
      typeof status.url === 'string' && status.url.length > 0
        ? status.url
        : contentUrl
    if (!nextUrl) continue

    const nextUrlHash = getStatusUrlHash(nextUrl)
    if (status.url === nextUrl && status.urlHash === nextUrlHash) {
      continue
    }

    await knex('statuses').where('id', status.id).update({
      url: nextUrl,
      urlHash: nextUrlHash
    })
  }
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasUrlHashColumn = await knex.schema.hasColumn('statuses', 'urlHash')
  if (hasUrlHashColumn) {
    await knex.schema.alterTable('statuses', function (table) {
      table.dropIndex(['urlHash'], 'statusesUrlHashIndex')
      table.dropColumn('urlHash')
    })
  }

  const hasUrlColumn = await knex.schema.hasColumn('statuses', 'url')
  if (hasUrlColumn) {
    await knex.schema.alterTable('statuses', function (table) {
      table.dropColumn('url')
    })
  }
}
