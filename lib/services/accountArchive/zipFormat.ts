import { crc32 } from 'zlib'

// A small zip writer that can be stopped and resumed. Two kinds of entry:
//
// - Known: the sizes and CRC-32 are known before the header is written (the
//   staged JSON documents, which are deflated part by part when they are
//   staged, and small generated documents). The header carries them and there
//   is no data descriptor, so streaming readers such as Java's ZipInputStream
//   can read them.
// - Streamed: a stored (uncompressed) file copied from storage, whose CRC is
//   only known at the end. It has a Zip64 data descriptor. Only the byte count
//   and the running CRC-32 need saving, which fit in a cursor; a compressed
//   entry would need the deflate state, which cannot be persisted.
//
// Readers that need the central directory (unzip, Python, Go, Java ZipFile,
// yauzl) read everything. A reader that streams without it can read the known
// entries but not the streamed ones.
//
// Layout: [local header, data, data descriptor]* then the central directory,
// the Zip64 end of central directory record and locator, and the end of
// central directory record. Readers use the central directory, which carries
// the final sizes and CRC, so the zero sizes in the local headers do not matter.

const UTF8_FLAG = 0x0800
const DATA_DESCRIPTOR_FLAG = 0x0008
const VERSION_ZIP64 = 45
const MAX_32 = 0xffffffff

export const updateCrc = (crc: number, chunk: Buffer) => crc32(chunk, crc)

/** MS-DOS date and time of a timestamp (UTC), which is all a zip entry stores. */
export const toDosDateTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107)
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      (date.getUTCSeconds() >> 1),
    date:
      ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  }
}

export type DosDateTime = ReturnType<typeof toDosDateTime>

const writeUInt64 = (buffer: Buffer, value: number, offset: number) => {
  buffer.writeBigUInt64LE(BigInt(value), offset)
}

/** What a "known" entry's header and central record carry. */
export interface KnownEntry {
  /** 0 stored, 8 deflated. */
  method: 0 | 8
  crc: number
  /** Uncompressed size. */
  size: number
  /** Size of the data as written (the deflated bytes, or the same as `size`). */
  csize: number
}

/**
 * The local file header. A streamed entry has zero sizes and CRC and the
 * descriptor carries them; a known entry carries them itself (in the Zip64
 * extra, so any size fits) and has no descriptor.
 */
export const buildLocalHeader = (
  name: string,
  dos: DosDateTime,
  known?: KnownEntry
) => {
  const nameBytes = Buffer.from(name, 'utf8')
  const header = Buffer.alloc(30 + nameBytes.length + 20)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(VERSION_ZIP64, 4)
  header.writeUInt16LE(known ? UTF8_FLAG : UTF8_FLAG | DATA_DESCRIPTOR_FLAG, 6)
  header.writeUInt16LE(known?.method ?? 0, 8)
  header.writeUInt16LE(dos.time, 10)
  header.writeUInt16LE(dos.date, 12)
  header.writeUInt32LE(known ? known.crc >>> 0 : 0, 14)
  header.writeUInt32LE(MAX_32, 18) // sizes: Zip64
  header.writeUInt32LE(MAX_32, 22)
  header.writeUInt16LE(nameBytes.length, 26)
  header.writeUInt16LE(20, 28)
  nameBytes.copy(header, 30)
  const extra = 30 + nameBytes.length
  header.writeUInt16LE(0x0001, extra)
  header.writeUInt16LE(16, extra + 2)
  if (known) {
    writeUInt64(header, known.size, extra + 4)
    writeUInt64(header, known.csize, extra + 12)
  }
  return header
}

/** Bytes of a local header, whatever its kind. */
export const localHeaderLength = (name: string) =>
  30 + Buffer.byteLength(name, 'utf8') + 20

/** The Zip64 data descriptor that closes a stored entry. */
export const buildDataDescriptor = (crc: number, size: number) => {
  const descriptor = Buffer.alloc(24)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(crc >>> 0, 4)
  writeUInt64(descriptor, size, 8)
  writeUInt64(descriptor, size, 16)
  return descriptor
}

export interface CentralEntry {
  name: string
  crc: number
  size: number
  headerOffset: number
  dos: DosDateTime
  /** Set for a known entry: its method and compressed size. */
  known?: KnownEntry
}

export const buildCentralRecord = (entry: CentralEntry) => {
  const nameBytes = Buffer.from(entry.name, 'utf8')
  const record = Buffer.alloc(46 + nameBytes.length + 28)
  record.writeUInt32LE(0x02014b50, 0)
  record.writeUInt16LE((3 << 8) | VERSION_ZIP64, 4) // made by Unix
  record.writeUInt16LE(VERSION_ZIP64, 6)
  record.writeUInt16LE(
    entry.known ? UTF8_FLAG : UTF8_FLAG | DATA_DESCRIPTOR_FLAG,
    8
  )
  record.writeUInt16LE(entry.known?.method ?? 0, 10)
  record.writeUInt16LE(entry.dos.time, 12)
  record.writeUInt16LE(entry.dos.date, 14)
  record.writeUInt32LE(entry.crc >>> 0, 16)
  record.writeUInt32LE(MAX_32, 20)
  record.writeUInt32LE(MAX_32, 24)
  record.writeUInt16LE(nameBytes.length, 28)
  record.writeUInt16LE(28, 30)
  record.writeUInt16LE(0, 32) // comment
  record.writeUInt16LE(0, 34) // disk
  record.writeUInt16LE(0, 36) // internal attributes
  record.writeUInt32LE((0o100644 << 16) >>> 0, 38)
  record.writeUInt32LE(MAX_32, 42)
  nameBytes.copy(record, 46)
  const extra = 46 + nameBytes.length
  record.writeUInt16LE(0x0001, extra)
  record.writeUInt16LE(24, extra + 2)
  writeUInt64(record, entry.size, extra + 4)
  writeUInt64(record, entry.known?.csize ?? entry.size, extra + 12)
  writeUInt64(record, entry.headerOffset, extra + 20)
  return record
}

/** The Zip64 end of central directory, its locator and the classic end record. */
export const buildEndRecords = ({
  entries,
  directoryOffset,
  directorySize
}: {
  entries: number
  directoryOffset: number
  directorySize: number
}) => {
  const zip64 = Buffer.alloc(56)
  zip64.writeUInt32LE(0x06064b50, 0)
  writeUInt64(zip64, 44, 4)
  zip64.writeUInt16LE((3 << 8) | VERSION_ZIP64, 12)
  zip64.writeUInt16LE(VERSION_ZIP64, 14)
  zip64.writeUInt32LE(0, 16)
  zip64.writeUInt32LE(0, 20)
  writeUInt64(zip64, entries, 24)
  writeUInt64(zip64, entries, 32)
  writeUInt64(zip64, directorySize, 40)
  writeUInt64(zip64, directoryOffset, 48)

  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeUInt32LE(0, 4)
  writeUInt64(locator, directoryOffset + directorySize, 8)
  locator.writeUInt32LE(1, 16)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(MAX_32, 12)
  end.writeUInt32LE(MAX_32, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([zip64, locator, end])
}

/** Entry names of a run of central directory records (what dedupe needs). */
export const readCentralNames = (directory: Buffer): string[] => {
  const names: string[] = []
  let position = 0
  while (position + 46 <= directory.length) {
    const nameLength = directory.readUInt16LE(position + 28)
    const extraLength = directory.readUInt16LE(position + 30)
    const commentLength = directory.readUInt16LE(position + 32)
    names.push(
      directory.toString('utf8', position + 46, position + 46 + nameLength)
    )
    position += 46 + nameLength + extraLength + commentLength
  }
  return names
}
