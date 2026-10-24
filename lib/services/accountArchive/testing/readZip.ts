import { spawnSync } from 'child_process'
import { writeFileSync } from 'fs'
import yauzl from 'yauzl'

/** Reads every entry of a zip file into memory (tests only). */
export const readZip = (
  file: string
): Promise<{
  names: string[]
  files: Map<string, Buffer>
  methods: Map<string, number>
}> =>
  new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error)
      const names: string[] = []
      const files = new Map<string, Buffer>()
      const methods = new Map<string, number>()
      zip.on('error', reject)
      zip.on('end', () => resolve({ names, files, methods }))
      zip.on('entry', (entry: yauzl.Entry) => {
        names.push(entry.fileName)
        methods.set(entry.fileName, entry.compressionMethod)
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

const STREAM_READER = `import java.io.FileInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class StreamZip {
  public static void main(String[] args) throws Exception {
    try (ZipInputStream zip = new ZipInputStream(new FileInputStream(args[0]))) {
      ZipEntry entry;
      while ((entry = zip.getNextEntry()) != null) {
        System.out.println(entry.getName() + "\\t" + zip.readAllBytes().length);
      }
      System.out.println("OK");
    }
  }
}
`

/**
 * Reads a zip front to back the way Java's `ZipInputStream` does, which ignores
 * the central directory. Returns the entry sizes it read, or the error text
 * when the reader gave up, or null when there is no Java here.
 */
export const readZipStreaming = (
  file: string,
  workDir: string
): { sizes: Map<string, number>; error: string | null } | null => {
  const source = `${workDir}/StreamZip.java`
  writeFileSync(source, STREAM_READER)
  const result = spawnSync('java', [source, file], { encoding: 'utf8' })
  if (result.error) return null
  const sizes = new Map<string, number>()
  for (const line of result.stdout.split('\n')) {
    const [name, size] = line.split('\t')
    if (size !== undefined) sizes.set(name, Number(size))
  }
  return {
    sizes,
    error: result.status === 0 ? null : result.stderr.trim() || 'failed'
  }
}
