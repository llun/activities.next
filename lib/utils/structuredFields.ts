/**
 * Minimal, strict RFC 8941 (Structured Field Values for HTTP) support: a
 * Dictionary parser and an Inner List serializer. The parser never throws; any
 * malformed input yields `null`.
 */

export type SfBareItem =
  | { type: 'string'; value: string }
  | { type: 'token'; value: string }
  | { type: 'integer'; value: number }
  | { type: 'decimal'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'bytes'; value: Buffer }

export type SfParameters = Array<[string, SfBareItem]>

export interface SfItem {
  item: SfBareItem
  params: SfParameters
}

export interface SfInnerList {
  items: SfItem[]
  params: SfParameters
}

export type SfMember =
  ({ kind: 'item' } & SfItem) | ({ kind: 'innerList' } & SfInnerList)

const KEY_FIRST = /^[a-z*]$/
const KEY_REST = /^[a-z0-9_\-.*]$/
const DIGIT = /^[0-9]$/
const ALPHA = /^[A-Za-z]$/
const TCHAR = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]$/
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

class SfParseError extends Error {}

class Cursor {
  pos = 0
  constructor(readonly input: string) {}
  get done() {
    return this.pos >= this.input.length
  }
  peek(): string {
    return this.input.charAt(this.pos)
  }
  next(): string {
    return this.input.charAt(this.pos++)
  }
}

const fail = (): never => {
  throw new SfParseError('invalid structured field')
}

const skipSp = (c: Cursor) => {
  while (c.peek() === ' ') c.pos++
}

const skipOws = (c: Cursor) => {
  while (c.peek() === ' ' || c.peek() === '\t') c.pos++
}

const parseKey = (c: Cursor): string => {
  if (!KEY_FIRST.test(c.peek())) return fail()
  let out = ''
  while (!c.done && KEY_REST.test(c.peek())) out += c.next()
  return out
}

const parseNumber = (c: Cursor): SfBareItem => {
  let sign = 1
  if (c.peek() === '-') {
    sign = -1
    c.pos++
  }
  if (!DIGIT.test(c.peek())) return fail()
  let intPart = ''
  let fracPart = ''
  let isDecimal = false
  while (!c.done) {
    const ch = c.peek()
    if (DIGIT.test(ch)) {
      c.pos++
      if (isDecimal) fracPart += ch
      else intPart += ch
    } else if (ch === '.' && !isDecimal) {
      if (intPart.length > 12) return fail()
      isDecimal = true
      c.pos++
    } else {
      break
    }
    if (!isDecimal && intPart.length > 15) return fail()
    if (isDecimal && fracPart.length > 3) return fail()
  }
  if (!isDecimal) {
    return { type: 'integer', value: sign * Number(intPart) }
  }
  if (fracPart.length === 0) return fail()
  return { type: 'decimal', value: sign * Number(`${intPart}.${fracPart}`) }
}

const parseString = (c: Cursor): SfBareItem => {
  c.pos++ // opening quote
  let out = ''
  while (!c.done) {
    const ch = c.next()
    if (ch === '\\') {
      if (c.done) return fail()
      const escaped = c.next()
      if (escaped !== '"' && escaped !== '\\') return fail()
      out += escaped
    } else if (ch === '"') {
      return { type: 'string', value: out }
    } else {
      const code = ch.charCodeAt(0)
      if (code < 0x20 || code > 0x7e) return fail()
      out += ch
    }
  }
  return fail()
}

const parseToken = (c: Cursor): SfBareItem => {
  let out = c.next()
  while (
    !c.done &&
    (TCHAR.test(c.peek()) || c.peek() === ':' || c.peek() === '/')
  ) {
    out += c.next()
  }
  return { type: 'token', value: out }
}

const parseBytes = (c: Cursor): SfBareItem => {
  c.pos++ // opening colon
  const end = c.input.indexOf(':', c.pos)
  if (end === -1) return fail()
  const b64 = c.input.slice(c.pos, end)
  c.pos = end + 1
  if (!BASE64.test(b64)) return fail()
  const padding = b64.length - b64.replace(/=+$/, '').length
  if (padding > 0) {
    // Padded text must be whole quanta; the non-padding part can then never
    // be 1 mod 4 (it is 2 or 3 after one or two '=').
    if (b64.length % 4 !== 0) return fail()
  } else if (b64.length % 4 === 1) {
    // RFC 8941 4.2.7: parsers SHOULD NOT fail when '=' padding is missing,
    // but a lone trailing character can never encode a whole byte.
    return fail()
  }
  return { type: 'bytes', value: Buffer.from(b64, 'base64') }
}

const parseBoolean = (c: Cursor): SfBareItem => {
  c.pos++ // '?'
  const ch = c.next()
  if (ch === '1') return { type: 'boolean', value: true }
  if (ch === '0') return { type: 'boolean', value: false }
  return fail()
}

const parseBareItem = (c: Cursor): SfBareItem => {
  const ch = c.peek()
  if (ch === '-' || DIGIT.test(ch)) return parseNumber(c)
  if (ch === '"') return parseString(c)
  if (ch === '*' || (ch !== '' && ALPHA.test(ch))) return parseToken(c)
  if (ch === ':') return parseBytes(c)
  if (ch === '?') return parseBoolean(c)
  return fail()
}

const MAX_PARAMETERS = 64

const parseParameters = (c: Cursor): SfParameters => {
  const params: SfParameters = []
  // key -> index in `params`, so a duplicate key replaces in O(1) while
  // keeping the position of its first occurrence.
  const indexes = new Map<string, number>()
  while (!c.done && c.peek() === ';') {
    c.pos++
    skipSp(c)
    const key = parseKey(c)
    let value: SfBareItem = { type: 'boolean', value: true }
    if (c.peek() === '=') {
      c.pos++
      value = parseBareItem(c)
    }
    const existing = indexes.get(key)
    if (existing !== undefined) {
      params[existing] = [key, value]
    } else {
      if (params.length >= MAX_PARAMETERS) return fail()
      indexes.set(key, params.length)
      params.push([key, value])
    }
  }
  return params
}

const parseItem = (c: Cursor): SfItem => {
  const item = parseBareItem(c)
  return { item, params: parseParameters(c) }
}

const parseInnerList = (c: Cursor): SfInnerList => {
  c.pos++ // '('
  const items: SfItem[] = []
  while (!c.done) {
    skipSp(c)
    if (c.peek() === ')') {
      c.pos++
      return { items, params: parseParameters(c) }
    }
    items.push(parseItem(c))
    const ch = c.peek()
    if (ch !== ' ' && ch !== ')') return fail()
  }
  return fail()
}

/**
 * Parse an RFC 8941 Dictionary. Returns `null` for any malformed input.
 * Never throws.
 */
export function parseSfDictionary(input: string): Map<string, SfMember> | null {
  try {
    if (typeof input !== 'string') return null
    const c = new Cursor(input)
    const result = new Map<string, SfMember>()
    skipSp(c)
    while (!c.done) {
      const key = parseKey(c)
      let member: SfMember
      if (c.peek() === '=') {
        c.pos++
        member =
          c.peek() === '('
            ? { kind: 'innerList', ...parseInnerList(c) }
            : { kind: 'item', ...parseItem(c) }
      } else {
        member = {
          kind: 'item',
          item: { type: 'boolean', value: true },
          params: parseParameters(c)
        }
      }
      result.set(key, member)
      skipOws(c)
      if (c.done) break
      if (c.next() !== ',') return null
      skipOws(c)
      if (c.done) return null // trailing comma
    }
    skipSp(c)
    if (!c.done) return null
    return result
  } catch {
    return null
  }
}

const serializeDecimal = (value: number): string => {
  const fixed = Math.abs(value).toFixed(3).replace(/0+$/, '')
  const text = fixed.endsWith('.') ? `${fixed}0` : fixed
  return value < 0 ? `-${text}` : text
}

export function serializeSfBareItem(item: SfBareItem): string {
  switch (item.type) {
    case 'string':
      return `"${item.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    case 'token':
      return item.value
    case 'integer':
      return String(item.value)
    case 'decimal':
      return serializeDecimal(item.value)
    case 'boolean':
      return item.value ? '?1' : '?0'
    case 'bytes':
      return `:${item.value.toString('base64')}:`
  }
}

export function serializeSfParameters(params: SfParameters): string {
  return params
    .map(([key, value]) =>
      value.type === 'boolean' && value.value
        ? `;${key}`
        : `;${key}=${serializeSfBareItem(value)}`
    )
    .join('')
}

/** Canonical RFC 8941 serialization of an Inner List with its parameters. */
export function serializeSfInnerList(list: SfInnerList): string {
  const inner = list.items
    .map(
      (i) => `${serializeSfBareItem(i.item)}${serializeSfParameters(i.params)}`
    )
    .join(' ')
  return `(${inner})${serializeSfParameters(list.params)}`
}
