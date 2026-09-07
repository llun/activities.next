/**
 * Inherit JSON-LD `@context` from a parent document (e.g. root collection or
 * collection page) into a child document (e.g. fetched page or outbox item).
 *
 * Preserves JSON-LD context semantics:
 * - Inherited parent definitions precede local child definitions in array ordering.
 * - Local definitions may override inherited definitions.
 * - An explicit null context in the child resets inheritance.
 * - Slices after the last `null` if a child context array contains `null`.
 */
export const inheritActivityPubContext = (
  parentContext: unknown,
  childContext: unknown
): unknown => {
  if (childContext === null) {
    return null
  }

  if (Array.isArray(childContext)) {
    const flatChild = childContext.flat(Infinity)
    const lastNullIndex = flatChild.lastIndexOf(null)
    if (lastNullIndex !== -1) {
      const remaining = flatChild.slice(lastNullIndex + 1)
      if (remaining.length === 0) {
        return null
      }
      return remaining.length === 1 ? remaining[0] : remaining
    }
  }

  if (childContext === undefined) {
    if (parentContext === undefined) return undefined
    if (parentContext === null) return null
    if (Array.isArray(parentContext)) {
      const flatParent = parentContext.flat(Infinity)
      const lastNullIndex = flatParent.lastIndexOf(null)
      if (lastNullIndex !== -1) {
        const remaining = flatParent.slice(lastNullIndex + 1)
        if (remaining.length === 0) return null
        return remaining.length === 1 ? remaining[0] : remaining
      }
      return parentContext
    }
    return parentContext
  }

  let resolvedParentEntries: unknown[] = []
  if (parentContext !== undefined && parentContext !== null) {
    const flatParent = Array.isArray(parentContext)
      ? parentContext.flat(Infinity)
      : [parentContext]
    const lastNullIndex = flatParent.lastIndexOf(null)
    resolvedParentEntries =
      lastNullIndex !== -1 ? flatParent.slice(lastNullIndex + 1) : flatParent
  }

  if (resolvedParentEntries.length === 0) {
    return childContext
  }

  const childEntries = Array.isArray(childContext)
    ? childContext.flat(Infinity)
    : [childContext]

  return [...resolvedParentEntries, ...childEntries]
}

/**
 * Applies the inherited context to an object document, attaching or updating
 * `@context` if effective context exists, or removing `@context` if undefined.
 */
export const applyInheritedContext = <T extends Record<string, unknown>>(
  parentContext: unknown,
  document: T
): T => {
  const effectiveContext = inheritActivityPubContext(
    parentContext,
    document['@context']
  )
  if (effectiveContext === undefined) {
    const { '@context': _context, ...rest } = document
    return rest as T
  }
  return {
    ...document,
    '@context': effectiveContext
  }
}
