import { z } from 'zod'

import {
  BaseNote,
  getContent,
  getLanguage,
  getSummary
} from '@/lib/activities/note'
import { persistDetectedLanguage } from '@/lib/services/language-detection'
import { notifyQuotedStatusUpdate } from '@/lib/services/notifications/notifyQuotedStatusUpdate'
import {
  ArticleContent,
  ImageContent,
  Note,
  PageContent,
  VideoContent
} from '@/lib/types/activitypub'
import { StatusType } from '@/lib/types/domain/status'
import { normalizeActivityPubContent } from '@/lib/utils/activitypub'

import { createJobHandle } from './createJobHandle'
import { UPDATE_NOTE_JOB_NAME } from './names'

export const updateNoteJob = createJobHandle(
  UPDATE_NOTE_JOB_NAME,
  async (database, message) => {
    // Intentionally excludes Question: poll updates are routed to updatePollJob
    // by getJobMessage, so a Question payload never reaches here. The parsed
    // note-like subset is a subset of BaseNote, so the cast widens.
    const BaseNoteSchema = z.union([
      Note,
      ImageContent,
      PageContent,
      ArticleContent,
      VideoContent
    ])
    const note = BaseNoteSchema.parse(
      normalizeActivityPubContent(message.data)
    ) as BaseNote
    const existingStatus = await database.getStatus({
      statusId: note.id,
      withReplies: false
    })
    if (!existingStatus || existingStatus.type !== StatusType.enum.Note) {
      return
    }

    if (
      note.type !== StatusType.enum.Note &&
      note.type !== 'Image' &&
      note.type !== 'Page' &&
      note.type !== 'Article' &&
      note.type !== 'Video'
    ) {
      return
    }

    const text = getContent(note)
    const summary = getSummary(note)
    // Refresh the language from the edited note, but preserve the existing
    // value when the update carries no locale (updateNote treats `undefined`
    // as "keep").
    const language = getLanguage(note) ?? undefined
    await database.updateNote({
      statusId: note.id,
      summary,
      text,
      language
    })

    // Re-detect the content language alongside the edit; the previous
    // detection (if any) is stale once the text changes — persistDetectedLanguage
    // clears the old row when the new content no longer detects confidently.
    await persistDetectedLanguage({
      database,
      statusId: note.id,
      text,
      html: true
    })

    // A remote status our users may have quoted was edited elsewhere; notify the
    // local authors of accepted quotes of it. The edit's author is the source.
    await notifyQuotedStatusUpdate({
      database,
      quotedStatusId: note.id,
      sourceActorId: existingStatus.actorId
    })
  }
)
