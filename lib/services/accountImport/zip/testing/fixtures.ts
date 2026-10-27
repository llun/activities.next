import {
  type DosDateTime,
  type KnownEntry,
  buildCentralRecord,
  buildDataDescriptor,
  buildEndRecords,
  buildLocalHeader,
  toDosDateTime
} from '@/lib/services/accountArchive/zipFormat'
import {
  BufferRandomAccessSource,
  type RandomAccessSource
} from '@/lib/services/accountImport/zip/source'

const DESCRIPTOR_LENGTH = 24

const DOS_TIME: DosDateTime = toDosDateTime(Date.UTC(2026, 9, 24, 12, 30, 10))

/** One entry of a fixture archive. */
export interface FixtureEntry {
  name: string
  data: Buffer
  /** The compression method the headers declare: 0 stored, 8 deflated. */
  method?: 0 | 8
  /** The POSIX mode the central record carries; a regular file by default. */
  mode?: number
  /** The uncompressed size the central record declares, when it must lie. */
  declaredSize?: number
  /** The compressed size the central record declares, when it must lie. */
  declaredCompressedSize?: number
}

/**
 * Builds an archive in memory. Every entry is written as a "known" entry:
 * the local header and the central record both carry the entry's sizes, and
 * a data descriptor closes the entry's data.
 */
export const buildZip = (entries: FixtureEntry[]): Buffer => {
  const pieces: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const known: KnownEntry = {
      method: entry.method ?? 0,
      crc: 0,
      size: entry.declaredSize ?? entry.data.length,
      csize: entry.declaredCompressedSize ?? entry.data.length
    }
    const header = buildLocalHeader(entry.name, DOS_TIME, known)
    pieces.push(header)
    pieces.push(entry.data)
    pieces.push(buildDataDescriptor(known.crc, known.csize))
    central.push(
      buildCentralRecord({
        name: entry.name,
        crc: known.crc,
        size: known.size,
        headerOffset: offset,
        dos: DOS_TIME,
        known
      })
    )
    offset += header.length + entry.data.length + DESCRIPTOR_LENGTH
  }
  const directory = Buffer.concat(central)
  pieces.push(directory)
  pieces.push(
    buildEndRecords({
      entries: entries.length,
      directoryOffset: offset,
      directorySize: directory.length
    })
  )
  return Buffer.concat(pieces)
}

/** A source over one archive's bytes, for the reader's open call. */
export const sourceOf = (archive: Buffer): RandomAccessSource =>
  new BufferRandomAccessSource(archive)
