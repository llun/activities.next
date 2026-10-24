export interface UnsentCounts {
  waiting: number
  drafts: number
  /** How many profiles the unsent posts belong to. */
  profiles?: number
}

/** The Alert's bold first sentence: how many posts have not been sent. */
export function unsentPostsTitle({
  waiting,
  drafts,
  profiles = 1
}: UnsentCounts): string {
  const total = waiting + drafts
  if (total === 0) return ''
  // The count, and the purge, cover the whole account, while Review drafts
  // lists the current profile's: say so when they differ.
  const where =
    profiles > 1 ? 'on this device across your profiles' : 'on this device'
  return total === 1
    ? `1 post ${where} has not been sent.`
    : `${total} posts ${where} have not been sent.`
}

/** The rest: which of them are waiting and which are drafts, and the warning. */
export function unsentPostsDetail({ waiting, drafts }: UnsentCounts): string {
  if (waiting + drafts === 0) return ''
  const waitingPart = `${waiting} ${waiting === 1 ? 'is' : 'are'} waiting to send`
  const draftsPart = `${drafts} ${drafts === 1 ? 'is a draft' : 'are drafts'}`
  const split =
    waiting > 0 && drafts > 0
      ? `${waitingPart} and ${draftsPart}.`
      : waiting > 0
        ? `${waitingPart}.`
        : `${draftsPart}.`
  return `${split} They are saved only on this device, so signing out deletes them and they cannot be restored.`
}

export function unsentPostsMessage(counts: UnsentCounts): string {
  const title = unsentPostsTitle(counts)
  return title ? `${title} ${unsentPostsDetail(counts)}` : ''
}
