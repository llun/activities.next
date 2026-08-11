import { gzipSync } from 'zlib'

import {
  getArchiveMediaMimeType,
  parseStravaArchiveCsvRows,
  parseStravaGearCsvRows,
  toStravaArchiveFitnessFilePayload
} from '@/lib/services/strava/archiveReader'

describe('archiveReader helpers', () => {
  describe('getArchiveMediaMimeType', () => {
    it('returns supported media MIME types', () => {
      expect(getArchiveMediaMimeType('media/photo.jpg')).toBe('image/jpeg')
      expect(getArchiveMediaMimeType('media/photo.jpeg')).toBe('image/jpeg')
      expect(getArchiveMediaMimeType('media/photo.png')).toBe('image/png')
      expect(getArchiveMediaMimeType('media/video.mp4')).toBe('video/mp4')
      expect(getArchiveMediaMimeType('media/video.mov')).toBe('video/quicktime')
      expect(getArchiveMediaMimeType('media/video.webm')).toBe('video/webm')
    })

    it('returns undefined for unsupported media types', () => {
      expect(getArchiveMediaMimeType('media/clip.heic')).toBeUndefined()
      expect(getArchiveMediaMimeType('media/clip.gif')).toBeUndefined()
    })
  })

  describe('toStravaArchiveFitnessFilePayload', () => {
    it('builds payload for uncompressed fitness file', async () => {
      const payload = await toStravaArchiveFitnessFilePayload({
        fitnessFilePath: 'activities/123.gpx',
        buffer: Buffer.from('<gpx />')
      })

      expect(payload.fileType).toBe('gpx')
      expect(payload.fileName).toBe('123.gpx')
      expect(payload.mimeType).toBe('application/gpx+xml')
      expect(payload.buffer.toString()).toBe('<gpx />')
    })

    it('gunzips compressed fitness file payloads', async () => {
      const payload = await toStravaArchiveFitnessFilePayload({
        fitnessFilePath: 'activities/123.fit.gz',
        buffer: gzipSync(Buffer.from('fit-binary'))
      })

      expect(payload.fileType).toBe('fit')
      expect(payload.fileName).toBe('123.fit')
      expect(payload.mimeType).toBe('application/vnd.ant.fit')
      expect(payload.buffer.toString()).toBe('fit-binary')
    })

    it('throws for unsupported fitness files', async () => {
      await expect(
        Promise.resolve().then(() =>
          toStravaArchiveFitnessFilePayload({
            fitnessFilePath: 'activities/123.csv',
            buffer: Buffer.from('bad')
          })
        )
      ).rejects.toThrow('Unsupported fitness file path')
    })

    it('rejects gzip output that exceeds the configured limit', async () => {
      await expect(
        toStravaArchiveFitnessFilePayload(
          {
            fitnessFilePath: 'activities/123.fit.gz',
            buffer: gzipSync(Buffer.from('oversized-gzip-output'))
          },
          { maxGzipOutputBytes: 4 }
        )
      ).rejects.toThrow('exceeds gzip output limit')
    })
  })

  describe('parseStravaArchiveCsvRows', () => {
    it('rejects CSV row-count overflow without allocating millions of rows', () => {
      const csv = ['Filename', 'activities/1.fit', 'activities/2.fit'].join(
        '\n'
      )

      expect(() => parseStravaArchiveCsvRows(csv, { maxRows: 2 })).toThrow(
        'exceeds CSV row limit'
      )
    })
  })

  describe('parseStravaGearCsvRows', () => {
    it('reads the named gear out of a bikes export', () => {
      const csv = [
        'Bike ID,Bike Name,Bike Brand',
        'b1234567,Moots Routt 45,Moots',
        'b7654321,Winter bike,Surly'
      ].join('\n')

      expect(parseStravaGearCsvRows(csv, 'bike')).toEqual([
        { name: 'Moots Routt 45', kind: 'bike' },
        { name: 'Winter bike', kind: 'bike' }
      ])
    })

    it('takes the kind from the caller, never from the CSV', () => {
      // The same rows read as `shoes` when they came out of shoes.csv — the
      // file decides, so a renamed or translated column cannot mis-file gear.
      const csv = ['Bike ID,Bike Name', 'b1234567,Moots Routt 45'].join('\n')

      expect(parseStravaGearCsvRows(csv, 'shoes')).toEqual([
        { name: 'Moots Routt 45', kind: 'shoes' }
      ])
    })

    it('falls back to the first column when no header mentions a name', () => {
      const csv = ['Gear,Marque', 'Moots Routt 45,Moots'].join('\n')

      expect(parseStravaGearCsvRows(csv, 'bike')).toEqual([
        { name: 'Moots Routt 45', kind: 'bike' }
      ])
    })

    it('strips the byte-order mark from the first header', () => {
      const csv = ['﻿Name,Brand', 'Nimbus 25,Hoka'].join('\n')

      expect(parseStravaGearCsvRows(csv, 'shoes')).toEqual([
        { name: 'Nimbus 25', kind: 'shoes' }
      ])
    })

    it('drops empty names and collapses duplicates', () => {
      const csv = [
        'Bike ID,Bike Name',
        'b1,Moots Routt 45',
        'b2,',
        'b3,  moots routt 45  '
      ].join('\n')

      expect(parseStravaGearCsvRows(csv, 'bike')).toEqual([
        { name: 'Moots Routt 45', kind: 'bike' }
      ])
    })

    it('returns no gear for an empty file', () => {
      expect(parseStravaGearCsvRows('', 'bike')).toEqual([])
    })
  })
})
