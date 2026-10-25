// The request headers the proxy uses to hand the [actor] layout the original
// profile path and query when it rewrites a bare local handle onto the
// qualified `/@user@domain` form (or forwards an already-qualified one), so
// `getLocalHandleRedirect` can 308 the same nested path and query under the
// current handle. The proxy DELETES both on every request it forwards and
// sets them only on the branches that rewrite to the profile: they are
// request-scoped facts about the URL, and a client-set value must never
// reach the layout on a path the proxy did not rewrite.
export const LOCAL_HANDLE_REDIRECT_PATH_HEADER =
  'x-activities-local-handle-path'
export const LOCAL_HANDLE_REDIRECT_SEARCH_HEADER =
  'x-activities-local-handle-search'
