import { marked } from 'marked'

export const convertMarkdownText = (text: string) =>
  marked.parse(text, { gfm: false })
