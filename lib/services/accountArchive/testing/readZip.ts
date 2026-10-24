import { spawnSync } from 'child_process'
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

/**
 * Checks a zip with the tools people use to open one: Info-ZIP's `unzip -t`
 * (every entry's CRC and sizes) and Python's `zipfile`. A tool that is not
 * installed is skipped, so the reader above is the floor.
 */
export const verifyZipWithTools = (file: string): string[] => {
  const used: string[] = []
  const unzip = spawnSync('unzip', ['-tq', file], { encoding: 'utf8' })
  if (!unzip.error) {
    used.push('unzip')
    if (unzip.status !== 0) {
      throw new Error(`unzip -t failed: ${unzip.stdout}${unzip.stderr}`)
    }
  }
  const python = spawnSync(
    'python3',
    [
      '-I',
      '-c',
      'import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nbad = z.testzip()\nsys.exit(1 if bad else 0)',
      file
    ],
    { encoding: 'utf8' }
  )
  if (!python.error) {
    used.push('python')
    if (python.status !== 0) {
      throw new Error(`zipfile check failed: ${python.stdout}${python.stderr}`)
    }
  }
  return used
}
