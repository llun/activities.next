import type { Readable } from 'stream'
import yazl from 'yazl'

export interface ArchiveZip {
  /** The zip bytes, in order; pipe it to storage. */
  outputStream: NodeJS.ReadableStream
  /** Adds an in-memory entry (compressed). */
  addBuffer(name: string, data: Buffer | string): void
  /**
   * Adds a streamed entry and resolves once the stream has been fully consumed
   * (so the caller can open the next source only then). `compress: false` is
   * for media, which is already compressed.
   *
   * Every streamed entry is written in Zip64 form: its size is not known up
   * front, and an entry that outgrows 4 GiB cannot be rewritten in that form
   * afterwards.
   */
  addStream(
    name: string,
    stream: Readable,
    options?: { compress?: boolean }
  ): Promise<void>
  /** Finishes the central directory (Zip64 when the entry count or offsets need it). */
  end(): void
}

/**
 * A streaming zip writer over `yazl`. Nothing is buffered beyond one chunk:
 * entries go through as they are added and the output backpressures the source.
 */
export const createArchiveZip = (mtime: Date): ArchiveZip => {
  const zip = new yazl.ZipFile()

  return {
    outputStream: zip.outputStream,
    addBuffer(name, data) {
      zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name, {
        mtime,
        compress: true
      })
    },
    addStream(name, stream, { compress = true } = {}) {
      return new Promise<void>((resolve, reject) => {
        stream.once('error', reject)
        stream.once('end', () => resolve())
        zip.addReadStream(stream, name, {
          mtime,
          compress,
          forceZip64Format: true
        })
      })
    },
    end() {
      zip.end()
    }
  }
}
