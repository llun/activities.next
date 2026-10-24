import { crc32 } from 'zlib'

// A small zip writer that can be stopped and resumed. Every entry is STORED (not
// compressed) with a Zip64 data descriptor, so an entry can be written in
// pieces over several job slices: the only state it needs is how many bytes of
// the entry are written and the running CRC-32, both of which fit in a cursor.
// A compressed entry would need the deflate state, which cannot be persisted.
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

/** The local file header: sizes and CRC are zero, the descriptor carries them. */
export const buildLocalHeader = (name: string, dos: DosDateTime) => {
  const nameBytes = Buffer.from(name, 'utf8')
  const header = Buffer.alloc(30 + nameBytes.length + 20)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(VERSION_ZIP64, 4)
  header.writeUInt16LE(UTF8_FLAG | DATA_DESCRIPTOR_FLAG, 6)
  header.writeUInt16LE(0, 8) // stored
  header.writeUInt16LE(dos.time, 10)
  header.writeUInt16LE(dos.date, 12)
  header.writeUInt32LE(0, 14) // crc, in the descriptor
  header.writeUInt32LE(MAX_32, 18) // sizes: Zip64, in the descriptor
  header.writeUInt32LE(MAX_32, 22)
  header.writeUInt16LE(nameBytes.length, 26)
  header.writeUInt16LE(20, 28)
  nameBytes.copy(header, 30)
  const extra = 30 + nameBytes.length
  header.writeUInt16LE(0x0001, extra)
  header.writeUInt16LE(16, extra + 2)
  // The two 8-byte sizes stay zero.
  return header
}

/** The Zip64 data descriptor that closes a stored entry. */
export const buildDataDescriptor = (crc: number, size: number) => {
  const descriptor = Buffer.alloc(24)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(crc >>> 0, 4)
  writeUInt64(descriptor, size, 8)
  writeUInt64(descriptor, size, 16)
  return descriptor
}

export const localEntryOverhead = (name: string) =>
  30 + Buffer.byteLength(name, 'utf8') + 20 + 24

export interface CentralEntry {
  name: string
  crc: number
  size: number
  headerOffset: number
  dos: DosDateTime
}

export const buildCentralRecord = (entry: CentralEntry) => {
  const nameBytes = Buffer.from(entry.name, 'utf8')
  const record = Buffer.alloc(46 + nameBytes.length + 28)
  record.writeUInt32LE(0x02014b50, 0)
  record.writeUInt16LE((3 << 8) | VERSION_ZIP64, 4) // made by Unix
  record.writeUInt16LE(VERSION_ZIP64, 6)
  record.writeUInt16LE(UTF8_FLAG | DATA_DESCRIPTOR_FLAG, 8)
  record.writeUInt16LE(0, 10)
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
  writeUInt64(record, entry.size, extra + 12)
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
