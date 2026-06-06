import { getTestSQLDatabase } from '@/lib/database/testUtils'

describe('CustomEmojiSQLDatabaseMixin', () => {
  const database = getTestSQLDatabase()

  beforeAll(async () => {
    await database.migrate()
  })

  afterAll(async () => {
    await database.destroy()
  })

  it('creates a custom emoji with defaults and reads it back', async () => {
    const created = await database.createCustomEmoji({
      shortcode: 'blobcat',
      url: 'https://example.com/emojis/blobcat.png',
      staticUrl: 'https://example.com/emojis/blobcat.png'
    })
    expect(created).toMatchObject({
      shortcode: 'blobcat',
      url: 'https://example.com/emojis/blobcat.png',
      staticUrl: 'https://example.com/emojis/blobcat.png',
      category: null,
      visibleInPicker: true,
      disabled: false
    })
    expect(created.id).toEqual(expect.any(String))
    expect(created.createdAt).toEqual(expect.any(Number))

    const byId = await database.getCustomEmojiById(created.id)
    expect(byId?.shortcode).toBe('blobcat')

    const byShortcode = await database.getCustomEmojiByShortcode('blobcat')
    expect(byShortcode?.id).toBe(created.id)
  })

  it('returns null for a missing emoji', async () => {
    expect(await database.getCustomEmojiById('missing')).toBeNull()
    expect(await database.getCustomEmojiByShortcode('missing')).toBeNull()
  })

  it('omits disabled emoji unless includeDisabled is set', async () => {
    await database.createCustomEmoji({
      shortcode: 'enabled_one',
      url: 'https://example.com/emojis/enabled.png',
      staticUrl: 'https://example.com/emojis/enabled.png'
    })
    const disabled = await database.createCustomEmoji({
      shortcode: 'disabled_one',
      url: 'https://example.com/emojis/disabled.png',
      staticUrl: 'https://example.com/emojis/disabled.png',
      disabled: true
    })

    const enabledOnly = await database.getCustomEmojis()
    expect(enabledOnly.map((emoji) => emoji.shortcode)).toContain('enabled_one')
    expect(enabledOnly.map((emoji) => emoji.shortcode)).not.toContain(
      'disabled_one'
    )

    const all = await database.getCustomEmojis({ includeDisabled: true })
    expect(all.map((emoji) => emoji.shortcode)).toContain('disabled_one')
    expect(all.find((emoji) => emoji.id === disabled.id)?.disabled).toBe(true)
  })

  it('updates category, visibility, and disabled flags', async () => {
    const created = await database.createCustomEmoji({
      shortcode: 'updatable',
      url: 'https://example.com/emojis/updatable.png',
      staticUrl: 'https://example.com/emojis/updatable.png'
    })

    const updated = await database.updateCustomEmoji({
      id: created.id,
      category: 'cats',
      visibleInPicker: false,
      disabled: true
    })
    expect(updated).toMatchObject({
      category: 'cats',
      visibleInPicker: false,
      disabled: true
    })

    // An unrelated update leaves the category untouched.
    const reEnabled = await database.updateCustomEmoji({
      id: created.id,
      disabled: false
    })
    expect(reEnabled?.category).toBe('cats')
    expect(reEnabled?.disabled).toBe(false)
  })

  it('returns null when updating a missing emoji', async () => {
    expect(
      await database.updateCustomEmoji({ id: 'missing', disabled: true })
    ).toBeNull()
  })

  it('deletes an emoji and returns the removed row', async () => {
    const created = await database.createCustomEmoji({
      shortcode: 'deletable',
      url: 'https://example.com/emojis/deletable.png',
      staticUrl: 'https://example.com/emojis/deletable.png'
    })

    const deleted = await database.deleteCustomEmoji(created.id)
    expect(deleted?.id).toBe(created.id)
    expect(await database.getCustomEmojiById(created.id)).toBeNull()
    expect(await database.deleteCustomEmoji(created.id)).toBeNull()
  })
})
