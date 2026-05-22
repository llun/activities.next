import { htmlToDOM } from 'html-react-parser'
import type {
  DOMNode,
  Element as HtmlElement,
  Text as HtmlText
} from 'html-react-parser'
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

type PlainTextDomNode = DOMNode | HtmlElement['children'][number]

const isTextNode = (node: PlainTextDomNode): node is HtmlText =>
  node.type === 'text'

const isElementNode = (node: PlainTextDomNode): node is HtmlElement =>
  node.type === 'tag' || node.type === 'script' || node.type === 'style'

const appendSpace = (parts: string[]) => {
  if (parts.length === 0 || parts[parts.length - 1] === ' ') return
  parts.push(' ')
}

const appendText = (parts: string[], text: string) => {
  if (!text) return
  parts.push(text)
}

const collectText = (nodes: PlainTextDomNode[], parts: string[]) => {
  nodes.forEach((node) => {
    if (isTextNode(node)) {
      appendText(parts, node.data)
      return
    }

    if (!isElementNode(node)) return

    if (node.name === 'br') {
      appendSpace(parts)
      return
    }

    if (BLOCK_TAGS.has(node.name)) {
      appendSpace(parts)
      collectText(node.children, parts)
      appendSpace(parts)
      return
    }

    collectText(node.children, parts)
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
