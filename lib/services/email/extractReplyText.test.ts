import { extractReplyText } from './extractReplyText'
import { REPLY_SENTINEL } from './replyMarker'

describe('extractReplyText', () => {
  it('keeps only what sits above the quoted sentinel', () => {
    const text = [
      'Sounds good, shipping it today.',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`,
      '>',
      '> @someone@example.tld mentioned you in a post.',
      '>',
      '> Message: are we shipping today?'
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Sounds good, shipping it today.')
  })

  it('keeps a multi-line reply intact', () => {
    const text = [
      'Two things:',
      '',
      '1. yes',
      '2. tomorrow',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe(
      'Two things:\n\n1. yes\n2. tomorrow'
    )
  })

  it('removes an attribution wrapped across lines', () => {
    const text = [
      'Ack.',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone Very Long Name',
      '<someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Ack.')
  })

  it('cuts at a quoted block when the sentinel is missing', () => {
    const text = [
      'Forwarding my answer.',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      '> the original message',
      '> spanning two lines'
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Forwarding my answer.')
  })

  it.each([
    {
      description: 'an Outlook original-message divider',
      tail: ['-----Original Message-----', 'From: someone@example.tld']
    },
    {
      description: 'a forwarded-message divider',
      tail: ['---------- Forwarded message ----------', 'From: a@b.tld']
    },
    {
      description: 'an Outlook underscore rule',
      tail: ['________________________________', 'From: a@b.tld']
    }
  ])('cuts at $description', ({ tail }) => {
    const text = ['My answer.', '', ...tail].join('\n')
    expect(extractReplyText({ text })).toBe('My answer.')
  })

  // Regression: Outlook puts an unquoted divider + header block BETWEEN the
  // reply and the quoted original. The sentinel cut alone left that block
  // behind, and because it carries no `>` markers the tail cleanup did not
  // remove it either — so the headers were posted as part of the status.
  it('drops an unquoted Outlook header block that sits above the sentinel', () => {
    const text = [
      'My actual reply.',
      '',
      '________________________________',
      'From: Activities <noreply@example.tld>',
      'Sent: Saturday 25 July 2026 21:00',
      'Subject: someone mentioned you',
      '',
      REPLY_SENTINEL
    ].join('\n')

    expect(extractReplyText({ text })).toBe('My actual reply.')
  })

  it('cuts at the sentinel even when the client hard-wrapped it', () => {
    // The sentinel no longer matches as one string, so the attribution
    // fallback has to carry the cut.
    const text = [
      'My actual reply.',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      '> --- Reply above this line to',
      '> respond ---',
      '> @someone mentioned you in a post.'
    ].join('\n')

    expect(extractReplyText({ text })).toBe('My actual reply.')
  })

  it('strips a trailing signature block', () => {
    const text = [
      'Done.',
      '',
      '-- ',
      'Alice',
      'Sent from a phone',
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Someone <someone@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe('Done.')
  })

  it('leaves a quoted signature delimiter alone', () => {
    const text = ['Reply body.', '', '> -- ', '> Their signature'].join('\n')
    expect(extractReplyText({ text })).toBe('Reply body.')
  })

  // Regression: htmlToPlainText collapses an HTML reply onto one line, so the
  // trailing "On … wrote:" shares that line with the sender's text. The
  // trailing-attribution step used to drop the whole line, which returned ''
  // and turned every Gmail HTML-only reply into a "we could not post" notice.
  it('keeps the sender text when the attribution shares its line', () => {
    const html =
      '<div dir="ltr">My reply text</div><br><div class="gmail_quote">' +
      '<div class="gmail_attr">On Sat, Jul 25, 2026 at 9:00 PM Activities ' +
      '&lt;noreply@example.tld&gt; wrote:<br></div><blockquote><p>' +
      `${REPLY_SENTINEL}</p><h3>@someone mentioned you</h3></blockquote></div>`

    expect(extractReplyText({ html })).toBe('My reply text')
  })

  // Regression: the same fallback also destroyed any plain-text reply whose
  // own last line happened to end in "wrote:".
  it('keeps a sentence of the sender that merely ends in wrote:', () => {
    const text = `Here is what she wrote:\n\n> ${REPLY_SENTINEL}`

    expect(extractReplyText({ text })).toBe('Here is what she wrote:')
  })

  // Regression: the inline trim matched leftmost, so it cut at the sender's
  // OWN first "On …"/"Am …" sentence and published the truncated remainder as
  // a real status, with no failure notice because something survived.
  it.each([
    {
      description: 'a sentence starting with On',
      body: '<div>Yes, that works.</div><div>On Tuesday I am offline.</div>',
      expected: 'Yes, that works. On Tuesday I am offline.'
    },
    {
      description: 'a sentence starting with Am',
      body: '<div>Thanks! Am I right that this ships today?</div>',
      expected: 'Thanks! Am I right that this ships today?'
    }
  ])(
    'keeps $description ahead of the quoted attribution',
    ({ body, expected }) => {
      const html =
        `${body}<div class="gmail_quote"><div class="gmail_attr">On Sat, ` +
        'Jul 25, 2026 at 9:00 PM Activities &lt;noreply@example.tld&gt; wrote:' +
        `<br></div><blockquote><p>${REPLY_SENTINEL}</p></blockquote></div>`

      expect(extractReplyText({ html })).toBe(expected)
    }
  )

  // Outlook's HTML reply uses <hr> (which htmlToPlainText drops) instead of a
  // row of underscores, so the whole-line divider cut cannot see it.
  it('drops an inline Outlook header run from a collapsed HTML reply', () => {
    const html =
      '<div>My actual reply.</div><hr><div id="divRplyFwdMsg">' +
      '<b>From:</b> Activities &lt;noreply@example.tld&gt;<br>' +
      '<b>Sent:</b> Saturday 25 July 2026 21:00<br>' +
      '<b>Subject:</b> someone mentioned you</div>' +
      `<p>${REPLY_SENTINEL}</p>`

    expect(extractReplyText({ html })).toBe('My actual reply.')
  })

  // Every cut heuristic keys on words that are ordinary English — "On", "Am",
  // "El", "From:" — so shape alone repeatedly truncated real posts. A real
  // header carries a date, a time or an address; a sentence does not.
  describe('does not mistake the sender prose for a quoted header', () => {
    it.each([
      {
        description: 'a sentence ending in wrote: with an On earlier',
        text: 'I asked El Nino about it and here is what he wrote:',
        expected: 'I asked El Nino about it and here is what he wrote:'
      },
      {
        description: 'an Am question ending in wrote:',
        text: 'Look at this. Am I wrong about what she wrote:',
        expected: 'Look at this. Am I wrong about what she wrote:'
      },
      {
        description: 'an On line two lines above a wrote: line',
        text: 'I checked the notes.\nOn the report you asked about,\nhere is what she wrote:',
        expected:
          'I checked the notes.\nOn the report you asked about,\nhere is what she wrote:'
      },
      {
        description: 'an Am line separated by a blank line',
        text: 'Am I late?\n\nRead what she wrote:',
        expected: 'Am I late?\n\nRead what she wrote:'
      }
    ])('keeps $description', ({ text, expected }) => {
      const body = `${text}\n\n> ${REPLY_SENTINEL}\n> quoted original`
      expect(extractReplyText({ text: body })).toBe(expected)
    })

    it('keeps a paragraph between an On sentence and the real attribution', () => {
      const text = [
        'Sure.',
        'On Friday I will be away.',
        '',
        'On 25 Jul 2026, Alice <alice@example.tld> wrote:',
        '> quoted original'
      ].join('\n')

      expect(extractReplyText({ text })).toBe(
        'Sure.\nOn Friday I will be away.'
      )
    })

    it('keeps a From: the sender typed, cutting only at the real block', () => {
      const text = [
        'Here is the header I got:',
        'From: postmaster@example.tld Subject: Undelivered Mail',
        '',
        'Any idea what that means?',
        '',
        '________________________________',
        'From: Alice <a@b.tld>',
        'Sent: Friday, 25 July 2026 10:00',
        'Subject: @alice replied to your post',
        '',
        REPLY_SENTINEL
      ].join('\n')

      expect(extractReplyText({ text })).toBe(
        'Here is the header I got:\nFrom: postmaster@example.tld Subject: Undelivered Mail\n\nAny idea what that means?'
      )
    })

    it.each([
      {
        description: 'a date without a clock time',
        line: 'On 25 July I asked Alice about the outage and here is what she wrote:'
      },
      {
        description: 'a version number',
        line: 'On v2 of the spec, this is what the author wrote:'
      }
    ])(
      'keeps prose whose only header-ish token is $description',
      ({ line }) => {
        const text = `Some context.\n${line}\n\n> ${REPLY_SENTINEL}\n> quoted`
        expect(extractReplyText({ text })).toBe(`Some context.\n${line}`)
      }
    )

    it('keeps a From: the sender typed in a collapsed Outlook HTML reply', () => {
      const html =
        '<div dir="ltr">The bounce says From: postmaster@example.tld — do ' +
        'you know why? I retried three times and it still fails.</div><hr>' +
        '<div><b>From:</b> Alice<br><b>Sent:</b> Friday, 25 July 2026 10:00' +
        `<br><b>Subject:</b> @alice replied</div><p>${REPLY_SENTINEL}</p>`

      expect(extractReplyText({ html })).toBe(
        'The bounce says From: postmaster@example.tld — do you know why? I retried three times and it still fails.'
      )
    })
  })

  // Regression: the gap between Sent: and Subject: was bounded at 80, but real
  // Outlook puts To: and often Cc: in between — so the run stopped matching and
  // the whole header block, including the REPLIER'S OWN email address, was
  // published and federated.
  it.each([
    {
      description: 'To: and Cc: lines',
      headers:
        '<b>To:</b> Bob Smith &lt;bob.smith@example.tld&gt;<br>' +
        '<b>Cc:</b> Team &lt;team@example.tld&gt;<br>'
    },
    {
      description: 'a corporate-length To: line',
      headers:
        '<b>To:</b> Bob Smith-Jones ' +
        '&lt;bob.smith-jones@engineering.example.com&gt;<br>'
    },
    {
      description: 'To: and Importance: lines',
      headers:
        '<b>To:</b> Bob &lt;bob@example.tld&gt;<br>' +
        '<b>Importance:</b> High<br>'
    }
  ])('drops an Outlook header block carrying $description', ({ headers }) => {
    const html =
      '<div>My actual reply.</div><hr><div id="divRplyFwdMsg">' +
      '<b>From:</b> Activities &lt;noreply@example.tld&gt;<br>' +
      '<b>Sent:</b> Saturday, July 25, 2026 9:00 PM<br>' +
      `${headers}<b>Subject:</b> someone mentioned you</div>` +
      `<p>${REPLY_SENTINEL}</p>`

    const extracted = extractReplyText({ html })
    expect(extracted).toBe('My actual reply.')
    expect(extracted).not.toContain('@example.tld')
  })

  // A single reply used to be able to pin the worker: the unbounded lazy span
  // rescanned the rest of the line for every "From:" on it, and an HTML body
  // collapses to ONE line of up to megabytes.
  //
  // The truncation cap is the guarantee worth asserting — it holds whatever
  // the regexes do, and unlike a wall-clock bound it does not flake under a
  // loaded parallel runner. The generous timing bound below is only a smoke
  // test for a future regex that backtracks catastrophically.
  it('truncates a body far larger than any status could be', () => {
    const extracted = extractReplyText({ text: 'x'.repeat(1024 * 1024) })

    expect(extracted).toHaveLength(256 * 1024)
  })

  it('does not blow up on a large single-line body', () => {
    const body = 'From: a '.repeat(50_000)
    const started = Date.now()

    extractReplyText({ text: body })

    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('falls back to the HTML part when there is no text part', () => {
    const html = `<p>Just this bit.</p><p>${REPLY_SENTINEL}</p><h3>@someone mentioned you</h3>`
    expect(extractReplyText({ html })).toBe('Just this bit.')
  })

  it('falls back to the HTML part when the text part is only whitespace', () => {
    const html = `<div>From the HTML part.</div><div>${REPLY_SENTINEL}</div>`
    expect(extractReplyText({ text: '   \n  ', html })).toBe(
      'From the HTML part.'
    )
  })

  it('normalizes CRLF line endings', () => {
    const text = `Windows reply.\r\n\r\n> ${REPLY_SENTINEL}\r\n> body`
    expect(extractReplyText({ text })).toBe('Windows reply.')
  })

  it.each([
    { description: 'both parts missing', input: {} },
    { description: 'an empty text part', input: { text: '' } },
    { description: 'a whitespace-only text part', input: { text: '  \n\n ' } },
    {
      description: 'nothing above the sentinel',
      input: { text: `${REPLY_SENTINEL}\n\n> quoted body` }
    },
    {
      description: 'only a quoted block',
      input: { text: '> quoted body\n> more quoted body' }
    },
    {
      description: 'only a signature above the quote',
      input: { text: `-- \nAlice\n\n> ${REPLY_SENTINEL}` }
    }
  ])('returns an empty string for $description', ({ input }) => {
    expect(extractReplyText(input)).toBe('')
  })

  it('does not cut a reply that merely contains the word wrote', () => {
    const text = [
      'I wrote: this is fine, keep it.',
      '',
      `> ${REPLY_SENTINEL}`
    ].join('\n')

    expect(extractReplyText({ text })).toBe('I wrote: this is fine, keep it.')
  })

  it('keeps the whole body when there is nothing to cut', () => {
    expect(extractReplyText({ text: 'just a plain reply' })).toBe(
      'just a plain reply'
    )
  })

  // Every case below published a TRUNCATED status before these guards: the
  // sender's own words were deleted and the fragment posted with no notice.
  // That is the one unrecoverable failure this module exists to avoid, so each
  // is pinned with the exact input that produced it.
  describe('never deletes what the sender wrote', () => {
    const CLIENT_QUOTE = [
      '',
      'On Sat, Jul 25, 2026 at 9:00 PM Activities <noreply@example.tld> wrote:',
      `> ${REPLY_SENTINEL}`,
      '> hello'
    ].join('\n')

    // The HTML part collapses to ONE line, so a reply that merely STARTS with
    // "On" looked like an attribution header and the whole reply vanished.
    it('keeps a one-line HTML reply that starts with On', () => {
      const html =
        '<div dir="ltr">On it!</div><div class="gmail_quote">' +
        '<div class="gmail_attr">On Sat, Jul 25, 2026 at 9:00 PM Activities ' +
        '&lt;noreply@example.tld&gt; wrote:<br></div>' +
        `<blockquote><p>${REPLY_SENTINEL}</p></blockquote></div>`

      expect(extractReplyText({ html })).toBe('On it!')
    })

    it.each([
      {
        name: 'an On sentence on its own line',
        body: 'Thanks, that clears it up.\nOn my read of the 15:00 call we already agreed, here is what Ada wrote:'
      },
      {
        name: 'an On sentence mid-line',
        body: 'Here is the note. On my read of the 15:00 standup, this is what Ada wrote:'
      }
    ])('keeps $name — a clock time is not a date', ({ body }) => {
      expect(extractReplyText({ text: body + CLIENT_QUOTE })).toBe(body)
    })

    // A pasted bounce has the same From:/Date:/Subject: shape as Outlook's
    // block, so only the tail tells them apart.
    it('keeps a mail header the sender pasted, and their question after it', () => {
      const html =
        '<div dir="ltr">Got this bounce today:</div>' +
        '<div>From: postmaster@example.tld</div>' +
        '<div>Date: Sat, 25 Jul 2026 09:00:00 +0000</div>' +
        '<div>Subject: Undelivered Mail Returned to Sender</div>' +
        '<div>Any idea what that means?</div>'

      expect(extractReplyText({ html })).toContain('Any idea what that means?')
    })

    it('keeps a postscript written below the signature delimiter', () => {
      const body =
        'Sounds good.\n\n-- \nAlice\n\nPS: the window moved to Thursday.'

      expect(extractReplyText({ text: body + CLIENT_QUOTE })).toContain(
        'PS: the window moved to Thursday.'
      )
    })

    it('keeps text below an underscore rule used as a prose separator', () => {
      const body =
        'Here are the two options.\n________________\nOption B is cheaper.'

      expect(extractReplyText({ text: body + CLIENT_QUOTE })).toContain(
        'Option B is cheaper.'
      )
    })

    // The other direction still has to work, or the guards would just disable
    // the parser.
    it('still drops a real contiguous signature', () => {
      const body = 'Sounds good.\n\n-- \nAlice\nAcme Corp'

      expect(extractReplyText({ text: body + CLIENT_QUOTE })).toBe(
        'Sounds good.'
      )
    })

    it('still drops a real inline attribution', () => {
      const body =
        'My reply text On Sat, Jul 25, 2026 at 9:00 PM Activities <noreply@example.tld> wrote:'

      expect(extractReplyText({ text: body + CLIENT_QUOTE })).toBe(
        'My reply text'
      )
    })
  })
})
