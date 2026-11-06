import {
  createInitialImportProgress,
  parseImportProgress,
  serializeImportProgress
} from '@/lib/services/accountImport/progress'

describe('parseImportProgress bookmarkFolderSkips', () => {
  it('round-trips the skip counts', () => {
    const progress = {
      ...createInitialImportProgress(),
      bookmarkFolderSkips: {
        bookmark_folder_too_large: 2,
        bookmark_folder_limit: 1
      }
    }

    expect(
      parseImportProgress(serializeImportProgress(progress)).bookmarkFolderSkips
    ).toEqual({ bookmark_folder_too_large: 2, bookmark_folder_limit: 1 })
  })

  it('drops unknown reasons and counts that are not positive integers', () => {
    const parsed = parseImportProgress(
      JSON.stringify({
        ...createInitialImportProgress(),
        bookmarkFolderSkips: {
          bookmark_folder_invalid: 3,
          made_up: 4,
          bookmark_folder_limit: 0,
          bookmark_folder_name_invalid: 1.5
        }
      })
    )

    expect(parsed.bookmarkFolderSkips).toEqual({ bookmark_folder_invalid: 3 })
    expect(
      parseImportProgress(
        serializeImportProgress(createInitialImportProgress())
      )
    ).not.toHaveProperty('bookmarkFolderSkips')
  })
})
