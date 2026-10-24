import yauzl from 'yauzl'

/** Reads every entry of a zip file into memory (tests only). */
export const readZip = (
  file: string
): Promise<{ names: string[]; files: Map<string, Buffer> }> =>
  new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error)
      const names: string[] = []
      const files = new Map<string, Buffer>()
      zip.on('error', reject)
      zip.on('end', () => resolve({ names, files }))
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName)
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError)
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(chunk))
          stream.on('error', reject)
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      })
      zip.readEntry()
    })
  })

/** Every object key found anywhere in a parsed JSON value. */
export const collectKeys = (value: unknown, keys = new Set<string>()) => {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}
