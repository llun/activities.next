import { TimelineContext } from '@/lib/types/domain/timeline'

// The parent previews a paged `TimelineFeed` surface keeps across load-more
// (the list timeline and a local profile's Posts and Replies tabs): the first
// page's context from the server render, then each later page's merged in, so a
// reply loaded on any page keeps its parent's preview.

export const initialTimelineContext = (
  context: TimelineContext | undefined
): TimelineContext => ({ ancestorsById: context?.ancestorsById ?? {} })

// Later pages win on a shared key: the same parent fetched again is the newer
// copy. A page with no previews leaves the state as it was, so the feed does
// not re-render for nothing.
export const mergeTimelineContext = (
  previous: TimelineContext,
  next: TimelineContext | undefined
): TimelineContext =>
  next && Object.keys(next.ancestorsById).length > 0
    ? { ancestorsById: { ...previous.ancestorsById, ...next.ancestorsById } }
    : previous
