/**
 * The focus rule for a failed archive start, upload or discard: the focus
 * the pressed control dropped when it unmounted goes to the first candidate
 * still able to take it, in this order — the waiting upload's Start import,
 * the showing alert's Retry or Try again, then the file picker.
 *
 * A candidate that is unmounted (its ref is null, or its node was detached)
 * or disabled cannot take the focus, so it falls through to the next one:
 * offline, say, disables the Start import and every Try again, and the
 * focus must not stop dead on a control the browser would ignore.
 */
export const focusStartCandidate = (
  candidates: ReadonlyArray<HTMLButtonElement | null | undefined>
): void => {
  for (const candidate of candidates) {
    if (candidate && candidate.isConnected && !candidate.disabled) {
      candidate.focus()
      return
    }
  }
}
