import { execFile } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

import {
  assertSafeDirectoryToReplace,
  isSafeArchiveEntryPath,
  isSafeTarArchiveVerboseEntry,
  validateTarArchivePaths
} from './productionArchive'

const execFileAsync = promisify(execFile)

describe('production archive scripts', () => {
  describe('assertSafeDirectoryToReplace', () => {
    it('rejects broad filesystem and workspace paths', () => {
      expect(() => assertSafeDirectoryToReplace('')).toThrow(
        'empty directory path'
      )
      expect(() => assertSafeDirectoryToReplace('/')).toThrow(
        'unsafe directory'
      )
      expect(() => assertSafeDirectoryToReplace(os.homedir())).toThrow(
        'unsafe directory'
      )
      expect(() =>
        assertSafeDirectoryToReplace(path.join(os.homedir(), 'Documents'))
      ).toThrow('unsafe directory')
      expect(() => assertSafeDirectoryToReplace(process.cwd())).toThrow(
        'unsafe directory'
      )
      expect(() =>
        assertSafeDirectoryToReplace(
          path.join(os.homedir(), 'Documents', 'uploads')
        )
      ).toThrow('outside safe storage root')
    })

    it('allows child directories under the safe storage root', () => {
      expect(
        assertSafeDirectoryToReplace('/tmp/activitynext/uploads', '/tmp')
      ).toBe('/tmp/activitynext/uploads')
    })

    it('allows the safe storage root itself as the restore target', () => {
      expect(
        assertSafeDirectoryToReplace(
          '/tmp/activitynext/uploads',
          '/tmp/activitynext/uploads'
        )
      ).toBe('/tmp/activitynext/uploads')
    })

    it('still rejects unsafe directories when they match the safe root', () => {
      expect(() =>
        assertSafeDirectoryToReplace(os.tmpdir(), os.tmpdir())
      ).toThrow('unsafe directory')
    })
  })

  describe('isSafeArchiveEntryPath', () => {
    it('accepts archive-relative paths', () => {
      expect(isSafeArchiveEntryPath('./manifest.json')).toBe(true)
      expect(isSafeArchiveEntryPath('storage/media/files/a.jpg')).toBe(true)
    })

    it('rejects archive paths that can escape the extraction directory', () => {
      expect(isSafeArchiveEntryPath('../x')).toBe(false)
      expect(isSafeArchiveEntryPath('/x')).toBe(false)
      expect(isSafeArchiveEntryPath('storage/../../x')).toBe(false)
      expect(isSafeArchiveEntryPath('..\\..\\etc\\passwd')).toBe(false)
      expect(isSafeArchiveEntryPath('storage\\..\\..\\x')).toBe(false)
      expect(isSafeArchiveEntryPath('\\absolute')).toBe(false)
    })
  })

  describe('validateTarArchivePaths', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'production-archive-test-')
      )
    })

    afterEach(async () => {
      await fs.rm(tempDir, { force: true, recursive: true })
    })

    it('rejects symlink and hardlink archive entries', async () => {
      const sourceDir = path.join(tempDir, 'source')
      await fs.mkdir(sourceDir)
      await fs.writeFile(path.join(sourceDir, 'file.txt'), 'content')
      await fs.symlink('/etc/passwd', path.join(sourceDir, 'link'))
      await fs.link(
        path.join(sourceDir, 'file.txt'),
        path.join(sourceDir, 'hardlink')
      )
      const archivePath = path.join(tempDir, 'archive.tar.gz')

      await execFileAsync('tar', ['-czf', archivePath, '-C', sourceDir, '.'])

      await expect(validateTarArchivePaths(archivePath)).rejects.toThrow(
        'unsupported entry type'
      )
    })

    it('accepts a safe archive from a relative path', async () => {
      const sourceDir = path.join(tempDir, 'relative-source')
      await fs.mkdir(sourceDir)
      await fs.writeFile(path.join(sourceDir, 'file.txt'), 'content')
      const archivePath = path.join(tempDir, 'relative-archive.tar.gz')
      const previousCwd = process.cwd()

      await execFileAsync('tar', ['-czf', archivePath, '-C', sourceDir, '.'])
      process.chdir(tempDir)
      try {
        await expect(
          validateTarArchivePaths('relative-archive.tar.gz')
        ).resolves.toBeUndefined()
      } finally {
        process.chdir(previousCwd)
      }
    })
  })

  describe('isSafeTarArchiveVerboseEntry', () => {
    it('rejects tar symlink and hardlink listings', () => {
      expect(
        isSafeTarArchiveVerboseEntry(
          'lrwxr-xr-x  0 llun staff 0 May  9 21:02 ./link -> /etc/passwd'
        )
      ).toBe(false)
      expect(
        isSafeTarArchiveVerboseEntry(
          'hrw-r--r--  0 llun staff 0 May  9 21:02 ./hard link to ./file'
        )
      ).toBe(false)
      expect(
        isSafeTarArchiveVerboseEntry(
          '-rw-r--r--  0 llun staff 7 May  9 21:02 ./file.txt'
        )
      ).toBe(true)
      expect(
        isSafeTarArchiveVerboseEntry(
          '  -rw-r--r--  0 llun staff 7 May  9 21:02 ./file.txt'
        )
      ).toBe(true)
      expect(
        isSafeTarArchiveVerboseEntry(
          '  lrwxr-xr-x  0 llun staff 0 May  9 21:02 ./link -> /etc/passwd'
        )
      ).toBe(false)
    })
  })
})
