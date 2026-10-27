import { StringDecoder } from 'node:string_decoder'

/** Reads selected string-valued root fields without parsing the whole entry. */
export const readTopLevelStringFields = async (
  chunks: AsyncIterable<Buffer>,
  selected: readonly string[],
  maxFieldBytes = 8 * 1024
): Promise<Record<string, string>> => {
  const decoder = new StringDecoder('utf8')
  const fields: Record<string, string> = {}
  let state: 'root' | 'key' | 'colon' | 'value' | 'afterValue' = 'root'
  let rootStarted = false
  let keyRaw = ''
  let key: string | null = null
  let valueRaw = ''
  let captureValue = false
  let valueTooLarge = false
  let valueStarted = false
  let depth = 0
  let inString = false
  let escape = false
  let primitive = false
  let done = false

  const finishValue = () => {
    if (key && captureValue && !valueTooLarge) {
      try {
        const value: unknown = JSON.parse(valueRaw)
        if (typeof value === 'string') fields[key] = value
      } catch {
        // A malformed field is left absent and rejected by the caller schema.
      }
    }
    key = null
    keyRaw = ''
    valueRaw = ''
    captureValue = false
    valueTooLarge = false
    valueStarted = false
    primitive = false
    state = 'afterValue'
  }

  const feed = (text: string) => {
    for (const ch of text) {
      if (done) continue
      if (!rootStarted) {
        if (/\s/.test(ch)) continue
        if (ch !== '{') throw new Error('Invalid actor document')
        rootStarted = true
        state = 'key'
        continue
      }
      if (state === 'key') {
        if (/\s|,/.test(ch)) continue
        if (ch === '}') {
          done = true
          continue
        }
        if (ch !== '"') throw new Error('Invalid actor document')
        keyRaw = '"'
        inString = true
        escape = false
        state = 'colon'
        // The next characters are collected by the key-mode branch below.
        continue
      }
      if (state === 'colon' && key === null) {
        if (keyRaw.length > 0 && keyRaw !== '"') {
          if (inString) {
            keyRaw += ch
            if (escape) escape = false
            else if (ch === '\\') escape = true
            else if (ch === '"') {
              inString = false
              try {
                key = JSON.parse(keyRaw) as string
              } catch {
                throw new Error('Invalid actor document')
              }
            }
          }
          continue
        }
        if (inString) {
          keyRaw += ch
          if (escape) escape = false
          else if (ch === '\\') escape = true
          else if (ch === '"') {
            inString = false
            try {
              key = JSON.parse(keyRaw) as string
            } catch {
              throw new Error('Invalid actor document')
            }
          }
          continue
        }
      }
      if (state === 'colon') {
        if (/\s/.test(ch)) continue
        if (ch !== ':') throw new Error('Invalid actor document')
        state = 'value'
        continue
      }
      if (state === 'value') {
        if (!valueStarted && /\s/.test(ch)) continue
        if (!valueStarted) {
          valueStarted = true
          captureValue = Boolean(key && selected.includes(key))
          if (ch === '"') {
            inString = true
            escape = false
          } else if (ch === '{' || ch === '[') {
            depth = 1
          } else {
            primitive = true
          }
        } else if (inString) {
          if (escape) escape = false
          else if (ch === '\\') escape = true
          else if (ch === '"') inString = false
        } else if (depth > 0) {
          if (ch === '"') {
            inString = true
            escape = false
          } else if (ch === '{' || ch === '[') depth += 1
          else if (ch === '}' || ch === ']') depth -= 1
        } else if (primitive && (ch === ',' || ch === '}')) {
          finishValue()
          if (ch === '}') done = true
          else state = 'key'
          continue
        }
        if (captureValue && !valueTooLarge) {
          valueRaw += ch
          if (Buffer.byteLength(valueRaw) > maxFieldBytes) {
            valueRaw = ''
            valueTooLarge = true
          }
        }
        if (!inString && depth === 0 && !primitive) finishValue()
        continue
      }
      if (state === 'afterValue') {
        if (/\s/.test(ch)) continue
        if (ch === ',') state = 'key'
        else if (ch === '}') done = true
        else throw new Error('Invalid actor document')
      }
    }
  }

  for await (const chunk of chunks) feed(decoder.write(chunk))
  feed(decoder.end())
  return fields
}
