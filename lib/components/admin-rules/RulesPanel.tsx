'use client'

import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { FC, FormEvent, useEffect, useRef, useState } from 'react'

import {
  type ServerRule,
  createServerRule,
  deleteServerRule,
  getServerRules,
  updateServerRule
} from '@/lib/client'
import { reorder } from '@/lib/components/admin-rules/reorder'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Textarea } from '@/lib/components/ui/textarea'
import { MAX_RULE_POSITION } from '@/lib/services/rules/adminRule'
import { cn } from '@/lib/utils'

// The server returns rules ordered by position ascending (ties broken by
// creation time). `Array.prototype.sort` is stable, so re-sorting after an
// edit preserves that tiebreak order for equal positions.
const sortRules = (rules: ServerRule[]): ServerRule[] =>
  [...rules].sort((a, b) => a.position - b.position)

// Normalize a reordered list to sequential positions (0, 1, 2, …) so the
// rule number shown in the UI is also the stored order.
const normalize = (rules: ServerRule[]): ServerRule[] =>
  rules.map((rule, index) => ({ ...rule, position: index }))

// The orange numbered chip that fronts every rule, matching the design system.
const RuleNumber: FC<{ n: number }> = ({ n }) => (
  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
    {n}
  </span>
)

export const RulesPanel: FC = () => {
  const [rules, setRules] = useState<ServerRule[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [newText, setNewText] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  // The rule currently being edited inline, plus its uncommitted field values.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editHint, setEditHint] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  // The row currently picked up by a drag, used to compute the drop target.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  // Polite live-region text announcing a reorder to screen readers.
  const [reorderStatus, setReorderStatus] = useState('')

  // Any in-flight mutation blocks the others: every write path takes an
  // optimistic snapshot and rolls back to it on failure, so overlapping writes
  // could otherwise restore a stale list.
  const busy = saving || deletingId !== null || savingEdit || reordering
  // A rule is open in the inline editor. While true, every other list action
  // (drag, keyboard reorder, other rows' Edit/Delete, the Add form) is blocked
  // so they can't silently discard the unsaved draft or shift the list under
  // the open editor.
  const editing = editingId !== null
  // Synchronous in-flight lock. `busy` is captured in each handler's closure at
  // render time, so two events fired in the same tick (e.g. rapid ArrowDown on
  // the grip before the disabled re-render lands) would both read a stale
  // `busy === false`. This ref flips synchronously to serialize them.
  const inFlightRef = useRef(false)

  useEffect(() => {
    let active = true
    getServerRules()
      .then((result) => {
        if (active) setRules(sortRules(result))
      })
      .catch(() => {
        // A network/parse failure must surface an error rather than silently
        // showing the "No rules yet" empty state.
        if (active) setListError('Failed to load rules. Please try again.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = newText.trim()
    if (!text || busy || editing || inFlightRef.current) return
    inFlightRef.current = true
    setSaving(true)
    setFormError(null)
    // Append the new rule after the current last one. createInstanceRule
    // defaults position to 0 (top), so pass an explicit trailing position.
    const nextPosition = Math.min(
      rules.reduce((max, rule) => Math.max(max, rule.position), -1) + 1,
      MAX_RULE_POSITION
    )
    try {
      // The client helper returns null on a non-ok response; throw so both
      // that and any network-layer rejection land in the same catch.
      const created = await createServerRule({
        text,
        hint: '',
        position: nextPosition
      })
      if (!created) {
        throw new Error('Failed to create rule. Please try again.')
      }
      setRules((current) => sortRules([...current, created]))
      setNewText('')
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Failed to create rule. Please try again.'
      )
    } finally {
      setSaving(false)
      inFlightRef.current = false
    }
  }

  const beginEdit = (rule: ServerRule) => {
    if (busy || editing) return
    setListError(null)
    setEditingId(rule.id)
    setEditText(rule.text)
    setEditHint(rule.hint)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
    setEditHint('')
  }

  const handleEditSave = async (rule: ServerRule) => {
    const text = editText.trim()
    // Bail on an emptied required field or while another write is in flight.
    if (!text || busy || inFlightRef.current) return
    const hint = editHint.trim()
    // Nothing changed — close the editor without a doomed round-trip.
    if (text === rule.text && hint === rule.hint) {
      cancelEdit()
      return
    }
    inFlightRef.current = true
    setSavingEdit(true)
    setListError(null)
    try {
      const updated = await updateServerRule(rule.id, { text, hint })
      if (!updated) {
        throw new Error('Failed to update rule. Please try again.')
      }
      setRules((current) =>
        sortRules(
          current.map((item) => (item.id === updated.id ? updated : item))
        )
      )
      cancelEdit()
    } catch {
      setListError('Failed to update rule. Please try again.')
    } finally {
      setSavingEdit(false)
      inFlightRef.current = false
    }
  }

  const handleDelete = async (rule: ServerRule) => {
    if (busy || inFlightRef.current) return
    inFlightRef.current = true
    setListError(null)
    setDeletingId(rule.id)
    const previous = rules
    // Optimistic removal — restore the row if the request fails. Writes are
    // serialized (see `busy`), so `previous` is always the current list.
    setRules((current) => current.filter((item) => item.id !== rule.id))
    const restoreOnFailure = () => {
      setRules(previous)
      setListError('Failed to delete rule. Please try again.')
    }
    try {
      const ok = await deleteServerRule(rule.id)
      if (!ok) restoreOnFailure()
    } catch {
      // A network-layer throw (connection drop, etc.) must still roll back.
      restoreOnFailure()
    } finally {
      setDeletingId(null)
      inFlightRef.current = false
    }
  }

  // Persist a reorder by writing back the new sequential position of every
  // rule whose position changed. Writes run sequentially (not Promise.all) to
  // avoid concurrent transactions contending for the same table; the first
  // failure stops the loop. On any failure the local state can no longer be
  // trusted (some writes may have landed), so resync from the server rather
  // than blindly restoring the pre-move snapshot.
  const persistReorder = async (
    reordered: ServerRule[],
    previous: ServerRule[]
  ) => {
    const changed = reordered.filter((rule, index) => {
      const before = previous.find((item) => item.id === rule.id)
      return before === undefined || before.position !== index
    })
    if (changed.length === 0) {
      inFlightRef.current = false
      return
    }
    setReordering(true)
    setListError(null)
    try {
      for (const rule of changed) {
        const updated = await updateServerRule(rule.id, {
          position: rule.position
        })
        if (!updated) {
          throw new Error('Failed to reorder rules. Please try again.')
        }
      }
    } catch {
      setListError('Failed to reorder rules. Please try again.')
      try {
        // Resync to the server's actual order after a partial write.
        const fresh = await getServerRules()
        setRules(sortRules(fresh))
      } catch {
        setRules(previous)
      }
    } finally {
      setReordering(false)
      inFlightRef.current = false
    }
  }

  const moveRule = (from: number, to: number) => {
    if (busy || inFlightRef.current) return
    // `reorder` returns the same reference for a no-op or out-of-range move
    // (e.g. ArrowUp on the first row), so bail before normalizing — otherwise
    // `normalize` would allocate a fresh array and could trigger a spurious
    // position write.
    const moved = reorder(rules, from, to)
    if (moved === rules) return
    inFlightRef.current = true
    const reordered = normalize(moved)
    const previous = rules
    setRules(reordered)
    setReorderStatus(`Moved rule to position ${to + 1} of ${reordered.length}.`)
    void persistReorder(reordered, previous)
  }

  const handleDrop = (toIndex: number) => {
    const fromIndex = dragIndex
    setDragIndex(null)
    setOverIndex(null)
    if (fromIndex === null) return
    moveRule(fromIndex, toIndex)
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Server rules"
        description="Displayed on the about page and served from the Mastodon rules API. Keep them short and specific — details go in the hint. Drag to reorder; the order is the rule number everywhere else."
      />

      {listError && <p className="text-sm text-destructive">{listError}</p>}

      <p aria-live="polite" className="sr-only">
        {reorderStatus}
      </p>

      {loading ? (
        <p className="rounded-2xl border bg-background/80 py-10 text-center text-sm text-muted-foreground shadow-sm">
          Loading rules…
        </p>
      ) : rules.length === 0 && !listError ? (
        // Suppress the empty-state copy when a load error is already shown, so a
        // failed fetch doesn't read as "you have no rules".
        <p className="rounded-2xl border bg-background/80 py-10 text-center text-sm text-muted-foreground shadow-sm">
          No rules yet — add one to show it on the about page.
        </p>
      ) : (
        <div className="divide-y rounded-2xl border bg-background/80 shadow-sm backdrop-blur">
          {rules.map((rule, index) => {
            const isEditing = editingId === rule.id
            const draggable = !busy && !editing
            return (
              <div
                key={rule.id}
                draggable={draggable}
                onDragStart={() => draggable && setDragIndex(index)}
                onDragOver={(event) => {
                  if (dragIndex === null) return
                  event.preventDefault()
                  setOverIndex(index)
                }}
                onDragLeave={() => {
                  // Clear the drop highlight when the cursor leaves this row, so
                  // dragging off the list doesn't leave a row stuck highlighted.
                  setOverIndex((current) =>
                    current === index ? null : current
                  )
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  handleDrop(index)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                className={cn(
                  'flex items-start gap-2 px-3 py-3 transition-colors',
                  overIndex === index &&
                    dragIndex !== null &&
                    dragIndex !== index &&
                    'bg-accent'
                )}
              >
                <button
                  type="button"
                  aria-label={`Reorder rule ${index + 1}: use arrow up and arrow down keys to move`}
                  disabled={busy || editing}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      moveRule(index, index - 1)
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      moveRule(index, index + 1)
                    }
                  }}
                  className="mt-1.5 cursor-grab rounded text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <GripVertical className="size-4" />
                </button>
                <RuleNumber n={index + 1} />
                {isEditing ? (
                  <form
                    className="min-w-0 flex-1 space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault()
                      // Guard explicitly: pressing Enter can submit even when
                      // the Save button is disabled. handleEditSave re-checks,
                      // but bail early here too to avoid a no-op round-trip.
                      if (savingEdit || editText.trim().length === 0) return
                      handleEditSave(rule)
                    }}
                  >
                    <Input
                      aria-label="Rule text"
                      value={editText}
                      maxLength={1000}
                      onChange={(event) => setEditText(event.target.value)}
                    />
                    <Textarea
                      aria-label="Rule hint"
                      value={editHint}
                      maxLength={2000}
                      rows={2}
                      placeholder="Hint (optional) — shown under the rule on the about page"
                      onChange={(event) => setEditHint(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={savingEdit || editText.trim().length === 0}
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={savingEdit}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-sm leading-snug font-medium">
                      {rule.text}
                    </p>
                    {rule.hint && (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                        {rule.hint}
                      </p>
                    )}
                  </div>
                )}
                {!isEditing && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Edit rule ${index + 1}`}
                      disabled={busy || editing}
                      onClick={() => beginEdit(rule)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete rule ${index + 1}`}
                      disabled={busy || editing}
                      onClick={() => handleDelete(rule)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <form onSubmit={handleCreate} className="space-y-2">
        <div className="flex gap-2">
          <Input
            aria-label="New rule text"
            placeholder="Add a rule…"
            value={newText}
            maxLength={1000}
            disabled={busy || editing}
            onChange={(event) => setNewText(event.target.value)}
          />
          <Button
            type="submit"
            disabled={busy || editing || newText.trim().length === 0}
          >
            <Plus className="size-4" />
            Add rule
          </Button>
        </div>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
      </form>
    </div>
  )
}
