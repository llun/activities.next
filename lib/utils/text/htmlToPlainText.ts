import { htmlToDOM } from 'html-react-parser'
import type { DOMNode } from 'html-react-parser'
import sanitizeHtml from 'sanitize-html'

const BLOCK_TAGS = new Set([
  'blockquote',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'ol',
  'p',
  'pre',
  'ul'
])

const ALLOWED_STRUCTURE_TAGS = ['br', ...BLOCK_TAGS]

type PlainTextNode = DOMNode & {
  type?: string
  data?: string
  name?: string
  children?: DOMNode[]
}

const appendSpace = (parts: string[]) => {
  if (parts.length === 0 || parts[parts.length - 1] === ' ') return
  parts.push(' ')
}

const appendText = (parts: string[], text: string) => {
  if (!text) return
  parts.push(text)
}

const collectText = (nodes: DOMNode[], parts: string[]) => {
  nodes.forEach((node) => {
    const plainTextNode = node as PlainTextNode

    if (plainTextNode.type === 'text') {
      appendText(parts, plainTextNode.data ?? '')
      return
    }

    if (plainTextNode.name === 'br') {
      appendSpace(parts)
      return
    }

    if (plainTextNode.children) {
      if (plainTextNode.name && BLOCK_TAGS.has(plainTextNode.name)) {
        appendSpace(parts)
        collectText(plainTextNode.children, parts)
        appendSpace(parts)
        return
      }

      collectText(plainTextNode.children, parts)
    }
  })
}

export const htmlToPlainText = (html: string | null | undefined) => {
  const sanitizedHtml = sanitizeHtml(html ?? '', {
    allowedTags: ALLOWED_STRUCTURE_TAGS,
    allowedAttributes: {}
  })
  const parts: string[] = []
  collectText(htmlToDOM(sanitizedHtml), parts)
  return parts.join('').replace(/\s+/g, ' ').trim()
}
