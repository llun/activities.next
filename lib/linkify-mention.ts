/*
Source: https://github.com/Hypercontext/linkifyjs/blob/main/packages/linkify-plugin-mention/src/mention.js

Copyright (c) 2021 SoapBox Innovations Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
 */
import {
  MultiToken,
  Plugin,
  State,
  createTokenClass,
  registerPlugin
} from 'linkifyjs'

const MentionToken = createTokenClass('mention', {
  isLink: true,
  toHref() {
    const mention = this.toString()
    const fragments = mention.slice(1).split('@')
    if (fragments.length === 2) {
      const [user, domain] = fragments
      return `//${domain}/@${user}`
    }

    return '/' + fragments[0]
  }
})

export const mention: Plugin = ({ scanner, parser }) => {
  const { HYPHEN, SLASH, UNDERSCORE, AT, DOT } = scanner.tokens
  const { domain } = scanner.tokens.groups

  // @
  const At = parser.start.tt(AT) // @

  // Begin with hyphen (not mention unless contains other characters)
  const AtHyphen = At.tt(HYPHEN)
  AtHyphen.tt(HYPHEN, AtHyphen)

  // Valid mention (not made up entirely of symbols)
  const Mention = At.tt(UNDERSCORE, MentionToken as any)

  At.ta(domain, Mention)
  AtHyphen.tt(UNDERSCORE, Mention)
  AtHyphen.ta(domain, Mention)

  // More valid mentions
  Mention.ta(domain, Mention)
  Mention.tt(HYPHEN, Mention)
  Mention.tt(UNDERSCORE, Mention)

  const MentionDomain = new State<MultiToken>()
  Mention.tt(AT, MentionDomain)
  MentionDomain.ta(domain, MentionDomain)
  MentionDomain.tt(DOT, MentionDomain)
  MentionDomain.ta(domain, MentionToken as any)

  // Mention with a divider
  const MentionDivider = Mention.tt(SLASH)

  // Once we get a word token, mentions can start up again
  MentionDivider.ta(domain, Mention)
  MentionDivider.tt(UNDERSCORE, Mention)
  MentionDivider.tt(HYPHEN, Mention)
}

registerPlugin('mention', mention)
