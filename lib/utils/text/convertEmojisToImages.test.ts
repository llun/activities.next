import { Tag } from '@/lib/types/domain/tag'

import { convertEmojisToImages } from './convertEmojisToImages'
import { escapeHtml } from './escapeHtml'
import {
  MAX_EMOJI_SHORTCODE_LENGTH,
  toEmojiShortcodeToken
} from './getEmojiTags'
import { processStatusTextContent } from './processStatusText'

const emojiTag = (name: string, value: string): Tag => ({
  type: 'emoji',
  createdAt: 0,
  updatedAt: 0,
  id: 'tag-1',
  statusId: 'https://llun.test/users/user1/statuses/1',
  name,
  value
})

describe('convertEmojisToImages', () => {
  it('converts all emojis inside text to image tags', () => {
    const time = Date.now()
    const tags: Tag[] = [
      {
        type: 'emoji',
        createdAt: time,
        value: 'https://llun.test/image1.png',
        name: ':image1:',
        id: '1',
        statusId: 'https://llun.test/users/user1/statuses/1',
        updatedAt: time
      },
      {
        createdAt: time,
        id: '2',
        value: 'https://llun.test/image2',
        updatedAt: time,
        type: 'emoji',
        name: ':image2:',
        statusId: 'https://llun.test/users/user1/statuses/1'
      }
    ]
    const text = '<p>Another test with custom emoji :image1: :image2:</p>'

    expect(convertEmojisToImages(text, tags)).toEqual(
      '<p>Another test with custom emoji <img class="emoji" src="https://llun.test/image1.png" alt=":image1:"></img> <img class="emoji" src="https://llun.test/image2" alt=":image2:"></img></p>'
    )
  })

  it('converts only emojis inside text', () => {
    const time = Date.now()
    const tags: Tag[] = [
      {
        id: '3',
        name: ':image3:',
        value: 'https://llun.test/image3',
        createdAt: time,
        updatedAt: time,
        type: 'emoji',
        statusId: 'https://llun.test/users/user1/statuses/2'
      },
      {
        createdAt: time,
        statusId: 'https://llun.test/users/user1/statuses/2',
        value: 'https://llun.test/users/user4',
        type: 'mention',
        updatedAt: time,
        name: '@user4@llun.test',
        id: '4'
      }
    ]
    const text =
      '<p><span class="h-card"><a href="https://llun.test/@user4" class="u-url mention">@<span>user4</span></a></span> Another test with custom emoji :image3:</p>'

    expect(convertEmojisToImages(text, tags)).toEqual(
      '<p><span class="h-card"><a href="https://llun.test/@user4" class="u-url mention">@<span>user4</span></a></span> Another test with custom emoji <img class="emoji" src="https://llun.test/image3" alt=":image3:"></img></p>'
    )
  })

  // Both interpolated values are attacker-controlled on the REMOTE path.
  // `createNoteJob` persists an inbound `Emoji` tag's `name` and `icon.url`
  // verbatim, and the AP schema only asks for `z.string()` — no shortcode
  // shape, no URL check. (The local path is safe by construction: `getEmojiTags`
  // only ever emits `:shortcode:` names resolved against this instance's own
  // emoji table.)
  //
  // This substitution runs BETWEEN the two sanitize passes, so anything it
  // splices in is markup the first pass already approved of and the second pass
  // will keep if it is on the allowlist. Unescaped, a `"` in the url closes the
  // src attribute and the rest of the value becomes live markup.
  describe('a hostile remote emoji tag', () => {
    // Escaping the url is necessary but NOT sufficient on its own, because a
    // string replacement re-reads `$` patterns in the replacement AFTER any
    // escaping: `$&` is the match and "$`" is everything before it. A url
    // carrying those spliced raw `<`, `>` and `"` from elsewhere in the post
    // into the src attribute — escaping never saw them, because they were not
    // in the url. Substituting through a FUNCTION is what makes `$` literal.
    it.each([
      { description: 'a match reference', url: 'https://cdn.test/$&x.png' },
      { description: 'a prefix reference', url: 'https://cdn.test/$`x.png' },
      { description: 'a suffix reference', url: "https://cdn.test/$'x.png" },
      { description: 'an escaped dollar', url: 'https://cdn.test/$$x.png' },
      { description: 'a group reference', url: 'https://cdn.test/$1x.png' }
    ])('writes a url containing $description literally', ({ url }) => {
      const html = convertEmojisToImages(
        '<p>secret <a href="https://real.test/">L</a> :blob:</p>',
        [emojiTag(':blob:', url)]
      )

      expect(html).toBe(
        `<p>secret <a href="https://real.test/">L</a> <img class="emoji" src="${escapeHtml(url)}" alt=":blob:"></img></p>`
      )
    })

    // The url is only ever written INTO the markup, so escaping is the whole
    // fix for it. The tag name here is a perfectly ordinary shortcode — it is
    // the value that is hostile.
    it('cannot break out of the src attribute', () => {
      const html = convertEmojisToImages('<p>hi :blob:</p>', [
        emojiTag(':blob:', 'https://cdn.test/e.png"><span class="invisible')
      ])

      expect(html).not.toContain('<span')
      expect(html).toBe(
        '<p>hi <img class="emoji" src="https://cdn.test/e.png&quot;&gt;&lt;span class=&quot;invisible" alt=":blob:"></img></p>'
      )
    })

    // What is searched for is a shortcode-shaped token, so a name that cannot
    // be one never matches anything and the text keeps whatever it said.
    // Markup is the case that used to consume the post's own anchor.
    it.each([
      { description: 'markup', name: '<a href="https://evil.test/">' },
      { description: 'a quote', name: '":' },
      { description: 'a space', name: ':bl ob:' },
      { description: 'a zero-width space', name: ':bl​ob:' },
      { description: 'empty', name: '::' },
      { description: 'nothing at all', name: '' }
    ])('ignores an emoji tag whose name contains $description', ({ name }) => {
      const text = `<p>hi ${name} there</p>`

      expect(
        convertEmojisToImages(text, [emojiTag(name, 'https://cdn.test/e.png')])
      ).toBe(text)
    })

    // The normalizer decides which names are ACCEPTED; a separate regex in
    // convertEmojisToImages decides which tokens are FOUND in the text. Raise
    // one without the other and a long name is accepted, stored, and then never
    // matched — an emoji that silently stops rendering with nothing to grep for.
    it('finds a token at the longest length the normalizer accepts', () => {
      const inner = 'a'.repeat(MAX_EMOJI_SHORTCODE_LENGTH)
      const name = `:${inner}:`

      expect(toEmojiShortcodeToken(name)).toBe(name)
      expect(
        convertEmojisToImages(`<p>hi ${name}</p>`, [
          emojiTag(name, 'https://cdn.test/e.png')
        ])
      ).toBe(
        `<p>hi <img class="emoji" src="https://cdn.test/e.png" alt="${name}"></img></p>`
      )
    })

    it('ignores an emoji tag whose name is longer than the cap', () => {
      const name = `:${'a'.repeat(MAX_EMOJI_SHORTCODE_LENGTH + 1)}:`
      const text = `<p>hi ${name} there</p>`

      expect(
        convertEmojisToImages(text, [emojiTag(name, 'https://cdn.test/e.png')])
      ).toBe(text)
    })
  })

  // Mastodon's `[a-zA-Z0-9_]{2,}` describes what Mastodon mints, not what
  // arrives. Every one of these was captured from a live Pleroma or Akkoma
  // instance, or is the documented shape of a server that emits it.
  describe('shortcodes the wider fediverse actually sends', () => {
    it.each([
      { description: 'a hyphen (Sharkey, Pleroma)', name: ':poi-love:' },
      { description: 'several hyphens', name: ':aro-sparkling-heart:' },
      { description: 'a dot (Akkoma pack filenames)', name: ':a.JPG:' },
      { description: 'a plus (Misskey, Hubzilla)', name: ':blob+cat:' },
      { description: 'one character (GoToSocial, Misskey)', name: ':c:' },
      { description: 'one digit', name: ':3:' },
      { description: 'non-ASCII (Esperanto, real)', name: ':afiŝo_miaŭ:' },
      { description: 'plain Mastodon shape', name: ':blobcat:' }
    ])('renders a shortcode with $description', ({ name }) => {
      const html = convertEmojisToImages(`<p>hi ${name} there</p>`, [
        emojiTag(name, 'https://cdn.test/e.png')
      ])

      expect(html).toBe(
        `<p>hi <img class="emoji" src="https://cdn.test/e.png" alt="${name}"></img> there</p>`
      )
    })

    // Friendica sends the name BARE while its post body still carries the
    // colons, so a tag that looks nothing like the text it is for is normal.
    it('renders a bare name against the colon-wrapped token in the text', () => {
      expect(
        convertEmojisToImages('<p>hi :like: there</p>', [
          emojiTag('like', 'https://cdn.test/e.png')
        ])
      ).toBe(
        '<p>hi <img class="emoji" src="https://cdn.test/e.png" alt=":like:"></img> there</p>'
      )
    })

    // The end-to-end consequence, through the real pipeline the reader gets:
    // a hidden anchor here is a phishing card. This is the SECOND half of that
    // defence — the extractor now runs the emoji step too, so it would see the
    // hiding — but the injection must not happen in the first place, because
    // then the reader is shown a post whose links are not what was published.
    //
    // A real shortcode, so the substitution actually happens and it is the
    // ESCAPING that has to hold. Naming something the filter rejects would pass
    // this without ever exercising the interpolation.
    it('cannot hide a link from the reader', () => {
      const rendered = processStatusTextContent(
        'llun.test',
        '<p>Check out my blog post! :blob:<a href="https://evil.test/phish">https://evil.test/phish</a></p>',
        [emojiTag(':blob:', 'https://cdn.test/e.png"><span class="invisible')],
        false
      )

      expect(rendered).toContain('<img')
      expect(rendered).not.toContain('class="invisible"')
      expect(rendered).not.toContain('class="hidden"')
      expect(rendered).toContain('href="https://evil.test/phish"')
    })

    // A shortcode is only a shortcode where a reader would read one. Inside
    // markup it is just characters, and `:` survives sanitization in an href,
    // so substituting there rewrote the very link the card was for: the reader
    // was left with `https://good.test/&lt;img class=` while the card still
    // named the original url. This needs no hostile emoji at all — an ordinary
    // custom emoji plus any link with a `:word:` path segment did it.
    it('does not substitute inside an attribute', () => {
      const text =
        '<p>see :blob: <a href="https://good.test/:blob:/article">good.test</a></p>'

      expect(
        convertEmojisToImages(text, [
          emojiTag(':blob:', 'https://cdn.test/e.png')
        ])
      ).toBe(
        '<p>see <img class="emoji" src="https://cdn.test/e.png" alt=":blob:"></img>' +
          ' <a href="https://good.test/:blob:/article">good.test</a></p>'
      )
    })

    // Every substitution writes an `alt=":shortcode:"` of its own, so feeding
    // each result into the next replacement let one tag match another's output
    // and nest markup inside an attribute. One pass over the original text
    // removes the possibility rather than arguing about which orders are safe.
    it('does not let one emoji match another emoji output', () => {
      const html = convertEmojisToImages('<p>:aa: :bb:</p>', [
        emojiTag(':aa:', 'https://cdn.test/a.png'),
        // A url that itself contains the second shortcode.
        emojiTag(':bb:', 'https://cdn.test/:aa:/b.png')
      ])

      expect(html).toBe(
        '<p><img class="emoji" src="https://cdn.test/a.png" alt=":aa:"></img>' +
          ' <img class="emoji" src="https://cdn.test/:aa:/b.png" alt=":bb:"></img></p>'
      )
    })

    it('uses the first tag when a shortcode is sent twice', () => {
      const html = convertEmojisToImages('<p>:aa:</p>', [
        emojiTag(':aa:', 'https://cdn.test/first.png'),
        emojiTag(':aa:', 'https://cdn.test/second.png')
      ])

      expect(html).toBe(
        '<p><img class="emoji" src="https://cdn.test/first.png" alt=":aa:"></img></p>'
      )
    })

    // The other half of the same primitive: `name` is the REPLACE TARGET, so a
    // name shaped like markup eats the surrounding tags instead of the text.
    it('cannot consume an anchor by matching its opening tag', () => {
      const rendered = processStatusTextContent(
        'llun.test',
        '<p><a href="https://evil.test/">Hello world</a></p>',
        [emojiTag('<a href="https://evil.test/">', 'https://cdn.test/e.png')],
        false
      )

      // The anchor the reader sees must still be there — losing it is how the
      // card ends up describing a link that is no longer in the post.
      expect(rendered).toContain('href="https://evil.test/"')
    })
  })
})
