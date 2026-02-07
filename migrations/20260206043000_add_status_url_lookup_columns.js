const crypto = require('crypto')

exports.config = { transaction: false }

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
  const hasUrlHashColumn = await knex.schema.hasColumn('statuses', 'urlHash')

  if (!hasUrlColumn || !hasUrlHashColumn) {
    console.log(
      `Adding columns to statuses: ${[!hasUrlColumn && 'url', !hasUrlHashColumn && 'urlHash'].filter(Boolean).join(', ')}...`
    )
    await knex.schema.alterTable('statuses', function (table) {
      if (!hasUrlColumn) {
        table.text('url').nullable()
      }
      if (!hasUrlHashColumn) {
        table.string('urlHash', 64).nullable()
        table.index('urlHash', 'statusesUrlHashIndex')
      }
    })
    console.log('  Columns added')
  } else {
    console.log('Columns url and urlHash already exist, skipping schema change')
  }

  const totalResult = await knex('statuses').count('* as cnt').first()
  const total = Number(totalResult.cnt)
  console.log(`Backfilling url/urlHash for ${total} statuses...`)

  const BATCH_SIZE = 500
  let lastId = ''
  let processed = 0
  let updated = 0

  while (true) {
    const statuses = await knex('statuses')
      .select('id', 'content', 'url', 'urlHash')
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(BATCH_SIZE)
    if (statuses.length === 0) break

    lastId = statuses[statuses.length - 1].id

    const updatePromises = []
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

      updatePromises.push(
        knex('statuses').where('id', status.id).update({
          url: nextUrl,
          urlHash: nextUrlHash
        })
      )
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises)
      updated += updatePromises.length
    }

    processed += statuses.length
    console.log(
      `  Progress: ${processed}/${total} (${Math.round((processed / total) * 100)}%) - ${updated} updated`
    )
  }

  console.log(`Done. Processed ${processed} statuses, updated ${updated}.`)
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasUrlHashColumn = await knex.schema.hasColumn('statuses', 'urlHash')
  const hasUrlColumn = await knex.schema.hasColumn('statuses', 'url')

  if (hasUrlHashColumn || hasUrlColumn) {
    await knex.schema.alterTable('statuses', function (table) {
      if (hasUrlHashColumn) {
        table.dropIndex(['urlHash'], 'statusesUrlHashIndex')
        table.dropColumn('urlHash')
      }
      if (hasUrlColumn) {
        table.dropColumn('url')
      }
    })
  }
}
