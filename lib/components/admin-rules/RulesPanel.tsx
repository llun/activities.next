'use client'

import { Plus, Trash2 } from 'lucide-react'
import { FC, FormEvent, useEffect, useState } from 'react'

import {
  type ServerRule,
  createServerRule,
  deleteServerRule,
  getServerRules,
  updateServerRule
} from '@/lib/client'
import { FilterField, FilterSection } from '@/lib/components/filters/filterUi'
import { PageHeader } from '@/lib/components/page-header'
import { Button } from '@/lib/components/ui/button'
import { Input } from '@/lib/components/ui/input'
import { Textarea } from '@/lib/components/ui/textarea'
import { MAX_RULE_POSITION } from '@/lib/services/rules/adminRule'

// The server returns rules ordered by position ascending (ties broken by
// creation time). `Array.prototype.sort` is stable, so re-sorting after an
// edit preserves that tiebreak order for equal positions.
const sortRules = (rules: ServerRule[]): ServerRule[] =>
  [...rules].sort((a, b) => a.position - b.position)

export const RulesPanel: FC = () => {
  const [rules, setRules] = useState<ServerRule[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [newText, setNewText] = useState('')
  const [newHint, setNewHint] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // Per-rule uncommitted position input values, keyed by rule id. A rule
  // without an entry shows its saved position.
  const [positionDrafts, setPositionDrafts] = useState<Record<string, string>>(
    {}
  )
  const [updatingPositionId, setUpdatingPositionId] = useState<string | null>(
    null
  )

  useEffect(() => {
    let active = true
    getServerRules()
      .then((result) => {
        if (active) setRules(result)
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
    // Also bail while a delete is in flight: the submit button is disabled
    // then, but a programmatic submit must not slip a create past the
    // delete-rollback snapshot.
    if (!text || saving || deletingId !== null) return
    setSaving(true)
    setFormError(null)
    try {
      // The client helper returns null on a non-ok response; throw so both
      // that and any network-layer rejection land in the same catch.
      const created = await createServerRule({ text, hint: newHint.trim() })
      if (!created) {
        throw new Error('Failed to create rule. Please try again.')
      }
      setRules((current) => sortRules([...current, created]))
      setNewText('')
      setNewHint('')
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : 'Failed to create rule. Please try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (rule: ServerRule) => {
    // A delete is already in flight — all delete buttons are disabled while
    // `deletingId` is set, so this guards against any racing invocation.
    if (deletingId) return
    setListError(null)
    setDeletingId(rule.id)
    const previous = rules
    // Optimistic removal — restore the row if the request fails. Deletes are
    // serialized (see the guard above), so `previous` is always the current
    // list and rolling back to it cannot resurrect a separately-deleted row.
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
    }
  }

  const handlePositionCommit = async (rule: ServerRule) => {
    // Bail while a delete is in flight. Disabling the input mid-edit fires its
    // onBlur, which would otherwise commit a position change past the
    // delete-rollback snapshot.
    if (deletingId !== null) return
    const draft = positionDrafts[rule.id]
    if (draft === undefined) return
    const clearDraft = () =>
      setPositionDrafts(({ [rule.id]: _removed, ...rest }) => rest)
    // An emptied field or an unchanged/invalid value reverts to the saved
    // position instead of sending an update.
    const next = Number(draft)
    // The `max` attribute only styles the field; a typed/pasted out-of-range
    // value still commits on blur. Reject it here (like negatives) so we revert
    // instead of firing a doomed request the server would 422.
    if (
      draft.trim() === '' ||
      !Number.isInteger(next) ||
      next < 0 ||
      next > MAX_RULE_POSITION ||
      next === rule.position
    ) {
      clearDraft()
      return
    }
    setListError(null)
    setUpdatingPositionId(rule.id)
    try {
      const updated = await updateServerRule(rule.id, { position: next })
      if (!updated) {
        throw new Error('Failed to update rule position. Please try again.')
      }
      setRules((current) =>
        sortRules(
          current.map((item) => (item.id === updated.id ? updated : item))
        )
      )
    } catch {
      setListError('Failed to update rule position. Please try again.')
    } finally {
      setUpdatingPositionId(null)
      clearDraft()
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rules"
        description="Moderation rules shown on the about page and served from the Mastodon rules API. Lower positions appear first."
      />

      {listError && <p className="text-sm text-destructive">{listError}</p>}

      <FilterSection
        title="Add a rule"
        description="Keep rules short and put the longer explanation in the hint."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <FilterField label="Rule text" htmlFor="rule-text">
            <Textarea
              id="rule-text"
              value={newText}
              onChange={(event) => setNewText(event.target.value)}
              maxLength={1000}
              rows={2}
              required
            />
          </FilterField>
          <FilterField
            label="Hint"
            htmlFor="rule-hint"
            help="Optional longer explanation rendered under the rule."
          >
            <Textarea
              id="rule-hint"
              value={newHint}
              onChange={(event) => setNewHint(event.target.value)}
              maxLength={2000}
              rows={2}
            />
          </FilterField>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex justify-end">
            <Button
              type="submit"
              // Block creation while a delete is in flight: the delete rollback
              // restores a pre-create snapshot, which would discard a rule
              // added mid-delete if the delete then fails.
              disabled={
                saving || deletingId !== null || newText.trim().length === 0
              }
            >
              <Plus className="size-4" />
              Add rule
            </Button>
          </div>
        </form>
      </FilterSection>

      <FilterSection>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading rules…
          </p>
        ) : rules.length === 0 && !listError ? (
          // Suppress the empty-state copy when a load error is already shown,
          // so a failed fetch doesn't read as "you have no rules".
          <p className="py-6 text-center text-sm text-muted-foreground">
            No rules yet — add one to show it on the about page.
          </p>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-start gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{rule.text}</p>
                  {rule.hint && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {rule.hint}
                    </p>
                  )}
                </div>
                <label
                  className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground"
                  htmlFor={`rule-position-${rule.id}`}
                >
                  Position
                  <Input
                    id={`rule-position-${rule.id}`}
                    type="number"
                    min={0}
                    // Match the 32-bit integer cap enforced server-side so the
                    // field flags out-of-range values before submission.
                    max={MAX_RULE_POSITION}
                    step={1}
                    className="w-20"
                    value={positionDrafts[rule.id] ?? String(rule.position)}
                    onChange={(event) =>
                      setPositionDrafts((current) => ({
                        ...current,
                        [rule.id]: event.target.value
                      }))
                    }
                    onBlur={() => handlePositionCommit(rule)}
                    // The input isn't inside a form, so Enter would otherwise do
                    // nothing. Blur on Enter to commit the position via onBlur.
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur()
                      }
                    }}
                    // Serialize position updates so two in-flight edits can't
                    // interleave their list re-sorts, and block edits while a
                    // delete is in flight so its rollback snapshot can't discard
                    // a position change committed mid-delete.
                    disabled={
                      updatingPositionId !== null || deletingId !== null
                    }
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Delete rule ${rule.text}`}
                  onClick={() => handleDelete(rule)}
                  // Keep all three mutations mutually exclusive: block deletes
                  // while any delete, create, or position edit is in flight.
                  // The delete rollback restores a snapshot captured before
                  // those writes, so a concurrent create/edit would otherwise be
                  // discarded if the delete then fails.
                  disabled={
                    deletingId !== null || saving || updatingPositionId !== null
                  }
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[hsl(0_84.2%_60.2%/0.4)] text-[hsl(0_72%_45%)] transition-colors hover:bg-[hsl(0_72%_45%/0.08)] disabled:pointer-events-none disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </FilterSection>
    </div>
  )
}
