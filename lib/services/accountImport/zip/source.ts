/**
 * A byte source the zip reader reads through. The importer gets one wherever
 * the archive lives: an in-memory Buffer in tests, or `readRange` on the
 * archive object store in production.
 */
import { Readable } from 'stream'

export interface RandomAccessSource {
  /** Total number of bytes the source holds. */
  readonly size: number
  /** The bytes from `start` to `endInclusive`, both inside the source. */
  read(start: number, endInclusive: number): Promise<Buffer>
}

/** How many bytes one pull of the range reader moves. */
const RANGE_CHUNK = 1024 * 1024

/**
 * A Readable over one range of a random-access source. yauzl drives it
 * through its base `read`, so only the byte window itself is read.
 */
export const rangeReadable = (
  source: RandomAccessSource,
  start: number,
  endInclusive: number
): Readable => {
  let position = start
  return new Readable({
    read() {
      if (position > endInclusive) {
        this.push(null)
        return
      }
      const end = Math.min(position + RANGE_CHUNK - 1, endInclusive)
      source
        .read(position, end)
        .then((data) => {
          this.push(data)
        })
        .catch((error: unknown) => {
          this.destroy(
            error instanceof Error ? error : new Error(String(error))
          )
        })
      position = end + 1
    }
  })
}

/** An in-memory source, for tests. */
export class BufferRandomAccessSource implements RandomAccessSource {
  constructor(private readonly buffer: Buffer) {}

  get size(): number {
    return this.buffer.length
  }

  async read(start: number, endInclusive: number): Promise<Buffer> {
    if (
      start < 0 ||
      endInclusive < start - 1 ||
      endInclusive >= this.buffer.length
    ) {
      throw new Error(
        `read range ${start}-${endInclusive} outside source of ${this.buffer.length} bytes`
      )
    }
    return Buffer.from(this.buffer.subarray(start, endInclusive + 1))
  }
}
