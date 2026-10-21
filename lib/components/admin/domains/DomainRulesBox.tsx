'use client'

import { GripVertical, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { FC, FormEvent, useEffect, useRef, useState } from 'react'

import {
  createServerRule,
  deleteServerRule,
  getServerRules,
  updateServerRule
} from '@/lib/client'
import { RuleNumber } from '@/lib/components/admin-rules/RuleNumber'
import { reorder } from '@/lib/components/admin-rules/reorder'
import { AllDomainsChip } from '@/lib/components/admin/domains/AllDomainsChip'
import { AddBar } from '@/lib/components/surface/AddBar'
import { Frame } from '@/lib/components/surface/Frame'
import { SaveBar } from '@/lib/components/surface/SaveBar'
import { Button } from '@/lib/components/ui/button'
import { Textarea } from '@/lib/components/ui/textarea'
import type { AdminRule } from '@/lib/services/rules/adminRule'
import { cn } from '@/lib/utils'

// A rule of the domain as the box edits it: `id` is null until it is saved.
type Draft = { key: string; id: string | null; text: string; hint: string }

const sortRules = (rules: AdminRule[]): AdminRule[] =>
  [...rules].sort((a, b) => a.position - b.position)

const toDrafts = (rules: AdminRule[]): Draft[] =>
  sortRules(rules).map((rule) => ({
    key: rule.id,
    id: rule.id,
    text: rule.text,
    hint: rule.hint
  }))

const MAX_TEXT = 1000

interface Props {
  domain: string
  serverRules: AdminRule[]
  ownRules: AdminRule[]
  /** The primary domain: it has no rules of its own, so only the server's show. */
  readOnly: boolean
}

const ServerRuleRows: FC<{ rules: AdminRule[]; chip: boolean }> = ({
  rules,
  chip
}) => (
  <ul className="space-y-2">
    {rules.map((rule, index) => (
      <li
        key={rule.id}
        className="bg-muted/60 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md px-3 py-2"
      >
        <RuleNumber n={index + 1} />
        <div className="min-w-0 flex-1 basis-40 pt-0.5">
          <p className="text-sm leading-snug font-medium break-words">
            {rule.text}
          </p>
          {rule.hint ? (
            <p className="text-muted-foreground mt-0.5 text-[13px] leading-relaxed">
              {rule.hint}
            </p>
          ) : null}
        </div>
        {chip ? <AllDomainsChip /> : null}
      </li>
    ))}
  </ul>
)

/**
 * The domain page's Rules box. The server rules come first, read-only with an
 * "All domains" chip; below them the domain's own rules are edited in a draft
 * (add, edit, remove, drag or arrow-key reorder) and written together by
 * "Save rules", like the other boxes of the page. The primary domain has no
 * rules of its own: its box shows the server rules and points to Server rules.
 */
export const DomainRulesBox: FC<Props> = ({
  domain,
  serverRules,
  ownRules,
  readOnly
}) => {
  const [baseline, setBaseline] = useState(() => sortRules(ownRules))
  const [drafts, setDrafts] = useState(() => toDrafts(ownRules))
  const [newText, setNewText] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [reorderStatus, setReorderStatus] = useState('')
  const [nextKey, setNextKey] = useState(0)
  const fieldRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const addRef = useRef<HTMLInputElement>(null)
  const gripRefs = useRef(new Map<string, HTMLButtonElement>())
  // The row whose grip the pointer is down on: only then is its row draggable,
  // so the rule's text field keeps native caret placement and text selection.
  const [armedKey, setArmedKey] = useState<string | null>(null)
  // The grip to focus once a keyboard move has re-rendered the rows.
  const focusGripAfterMove = useRef<string | null>(null)
  // Where focus goes once a removed rule's row is gone: a draft key, or null
  // for the add field. `undefined` means nothing is pending.
  const focusAfterRemove = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const target = focusAfterRemove.current
    if (target === undefined) return
    focusAfterRemove.current = undefined
    const field =
      target === null ? addRef.current : fieldRefs.current.get(target)
    ;(field ?? addRef.current)?.focus()
  }, [drafts])
  useEffect(() => {
    const key = focusGripAfterMove.current
    if (key === null) return
    focusGripAfterMove.current = null
    gripRefs.current.get(key)?.focus()
  }, [drafts])
  useEffect(() => {
    if (armedKey === null) return
    const disarm = () => setArmedKey(null)
    // Not pointercancel: iOS Safari may send it before dragstart, once the
    // browser takes the gesture over for a drag.
    window.addEventListener('pointerup', disarm)
    return () => window.removeEventListener('pointerup', disarm)
  }, [armedKey])

  const sortedServerRules = sortRules(serverRules)

  if (readOnly) {
    return (
      <Frame
        footer={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <p className="text-muted-foreground text-sm">
              The primary domain has no rules of its own. These are the server
              rules.
            </p>
            <Link
              href="/admin/rules"
              className="text-primary-text text-sm font-medium underline"
            >
              Edit in Server rules
            </Link>
          </div>
        }
      >
        <div className="p-4">
          {sortedServerRules.length > 0 ? (
            <ServerRuleRows rules={sortedServerRules} chip={false} />
          ) : (
            <p className="text-muted-foreground text-sm">
              There are no server rules yet.
            </p>
          )}
        </div>
      </Frame>
    )
  }

  const trimmed = drafts.map((draft) => ({
    ...draft,
    text: draft.text.trim()
  }))
  const dirty =
    trimmed.length !== baseline.length ||
    trimmed.some(
      (draft, index) =>
        draft.id !== baseline[index].id || draft.text !== baseline[index].text
    )
  const missing = trimmed.some((draft) => draft.text === '')

  const edit = (patch: (current: Draft[]) => Draft[]) => {
    setSaved(false)
    setDrafts(patch)
  }

  const addRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = newText.trim()
    if (!text || saving) return
    const key = `new-${nextKey}`
    setNextKey(nextKey + 1)
    edit((current) => [...current, { key, id: null, text, hint: '' }])
    setNewText('')
  }

  const moveRule = (from: number, to: number): boolean => {
    if (saving) return false
    const moved = reorder(drafts, from, to)
    if (moved === drafts) return false
    edit(() => moved)
    setReorderStatus(
      `Moved rule to position ${offset + to + 1} of ${offset + moved.length}.`
    )
    return true
  }

  const resync = (rules: AdminRule[]) => {
    setBaseline(sortRules(rules))
    setDrafts(toDrafts(rules))
  }

  // The writes run one after another (the first failure stops them). Each
  // success is recorded at once, in the baseline and in the draft's id, so a
  // failure part-way leaves the box knowing what the server already has: a
  // retry neither creates a rule twice nor deletes one again.
  const save = async () => {
    setSaving(true)
    setError(null)
    let base = [...baseline]
    const recordBaseline = (next: AdminRule[]) => {
      base = next
      setBaseline(sortRules(next))
    }
    try {
      const keep = new Set(trimmed.flatMap((draft) => draft.id ?? []))
      for (const rule of baseline) {
        if (keep.has(rule.id)) continue
        if (!(await deleteServerRule(rule.id))) {
          throw new Error('Failed to remove a rule.')
        }
        recordBaseline(base.filter((item) => item.id !== rule.id))
      }
      for (const [index, draft] of trimmed.entries()) {
        if (draft.id === null) {
          const created = await createServerRule({
            domain,
            text: draft.text,
            hint: draft.hint,
            position: index
          })
          if (!created) throw new Error('Failed to add a rule.')
          recordBaseline([...base, created])
          setDrafts((current) =>
            current.map((item) =>
              item.key === draft.key ? { ...item, id: created.id } : item
            )
          )
          continue
        }
        const before = base.find((rule) => rule.id === draft.id)
        if (!before) continue
        const patch = {
          ...(draft.text !== before.text ? { text: draft.text } : null),
          ...(before.position !== index ? { position: index } : null)
        }
        if (Object.keys(patch).length === 0) continue
        const updated = await updateServerRule(draft.id, patch)
        if (!updated) throw new Error('Failed to update a rule.')
        recordBaseline(
          base.map((rule) => (rule.id === updated.id ? updated : rule))
        )
      }
      resync(base)
      setSaved(true)
    } catch {
      setError('Failed to save the rules. Check the list and try again.')
      try {
        // Show what the server really has, with the drafts that are not
        // written yet kept on top of it.
        const server = await getServerRules(domain)
        const onServer = new Set(server.map((rule) => rule.id))
        setBaseline(sortRules(server))
        setDrafts((current) =>
          current.map((item) =>
            item.id !== null && !onServer.has(item.id)
              ? { ...item, id: null }
              : item
          )
        )
      } catch {
        // The baseline already holds every write that succeeded, so the admin
        // can try again from here.
      }
    } finally {
      setSaving(false)
    }
  }

  const offset = sortedServerRules.length

  return (
    <Frame
      footer={
        <SaveBar
          actionLabel="Save rules"
          idleNote={
            <>
              Changes apply to <span className="break-all">{domain}</span> only.
            </>
          }
          dirty={dirty}
          saving={saving}
          saved={saved}
          error={error}
          disabledReason={missing ? 'Every rule needs text' : undefined}
          onSave={() => void save()}
        />
      }
    >
      <div className="space-y-4 p-4">
        <p aria-live="polite" className="sr-only">
          {reorderStatus}
        </p>
        {sortedServerRules.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">
              Server rules{' '}
              <span className="text-muted-foreground font-normal">
                · same on every domain
              </span>
            </h3>
            <ServerRuleRows rules={sortedServerRules} chip />
          </div>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Rules for <span className="break-all">{domain}</span>
          </h3>
          {drafts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              <span className="break-all">{domain}</span> has no rules of its
              own yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {drafts.map((draft, index) => (
                <li
                  key={draft.key}
                  draggable={!saving && armedKey === draft.key}
                  onDragStart={(event) => {
                    // Only a drag that starts on the row itself reorders (the
                    // row is draggable only while armed by the grip). A text
                    // drag from the field bubbles here and is left alone.
                    if (saving || event.target !== event.currentTarget) return
                    // Firefox starts no drag without data. A custom type, not
                    // text/plain, so no text field accepts the row as a drop.
                    event.dataTransfer.setData(
                      'application/x-domain-rule',
                      draft.key
                    )
                    event.dataTransfer.effectAllowed = 'move'
                    setDragIndex(index)
                  }}
                  onDragOver={(event) => {
                    if (dragIndex === null) return
                    event.preventDefault()
                    setOverIndex(index)
                  }}
                  onDragLeave={() =>
                    setOverIndex((current) =>
                      current === index ? null : current
                    )
                  }
                  onDrop={(event) => {
                    // Only a row drag is handled: native text drops into the
                    // fields keep their default.
                    const from = dragIndex
                    if (from === null) return
                    event.preventDefault()
                    setDragIndex(null)
                    setOverIndex(null)
                    moveRule(from, index)
                  }}
                  onDragEnd={() => {
                    setArmedKey(null)
                    setDragIndex(null)
                    setOverIndex(null)
                  }}
                  className={cn(
                    'flex items-start gap-2 rounded-md transition-colors',
                    overIndex === index &&
                      dragIndex !== null &&
                      dragIndex !== index &&
                      'bg-accent'
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Reorder rule ${offset + index + 1}: use arrow up and arrow down keys to move`}
                    disabled={saving}
                    ref={(element) => {
                      if (element) gripRefs.current.set(draft.key, element)
                      else gripRefs.current.delete(draft.key)
                    }}
                    onPointerDown={(event) => {
                      if (event.button === 0) setArmedKey(draft.key)
                    }}
                    onKeyDown={(event) => {
                      const to =
                        event.key === 'ArrowUp'
                          ? index - 1
                          : event.key === 'ArrowDown'
                            ? index + 1
                            : null
                      if (to === null) return
                      event.preventDefault()
                      if (moveRule(index, to)) {
                        focusGripAfterMove.current = draft.key
                      }
                    }}
                    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mt-2 cursor-grab rounded transition-colors focus-visible:ring-[3px] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <GripVertical className="size-4" />
                  </button>
                  <span className="mt-1">
                    <RuleNumber n={offset + index + 1} />
                  </span>
                  <Textarea
                    ref={(element) => {
                      if (element) fieldRefs.current.set(draft.key, element)
                      else fieldRefs.current.delete(draft.key)
                    }}
                    aria-label={`Rule ${offset + index + 1} text`}
                    rows={1}
                    value={draft.text}
                    maxLength={MAX_TEXT}
                    disabled={saving}
                    className="min-h-9 flex-1 resize-none py-1.5"
                    onKeyDown={(event) => {
                      // A rule is one line: Enter must not start a second one.
                      if (
                        event.key === 'Enter' &&
                        !event.nativeEvent.isComposing
                      )
                        event.preventDefault()
                    }}
                    onChange={(event) =>
                      edit((current) =>
                        current.map((item) =>
                          item.key === draft.key
                            ? { ...item, text: event.target.value }
                            : item
                        )
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`Remove rule ${offset + index + 1}`}
                    disabled={saving}
                    className="text-muted-foreground hover:text-destructive-text shrink-0"
                    onClick={() => {
                      // Focus moves to the next row's field, else the add field.
                      focusAfterRemove.current = drafts[index + 1]?.key ?? null
                      edit((current) =>
                        current.filter((item) => item.key !== draft.key)
                      )
                    }}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AddBar
          label={`New rule for ${domain}`}
          buttonLabel="Add"
          buttonDisabled={saving || newText.trim().length === 0}
          onSubmit={addRule}
          className="rounded-none border-0 bg-transparent p-0"
          inputRef={addRef}
          inputProps={{
            placeholder: `Add a rule for ${domain}`,
            value: newText,
            maxLength: MAX_TEXT,
            disabled: saving,
            onChange: (event) => setNewText(event.target.value)
          }}
        />

        <p className="text-muted-foreground text-sm">
          Server rules apply on every domain. Edit them in{' '}
          <Link
            href="/admin/rules"
            className="text-primary-text font-medium underline"
          >
            Server rules
          </Link>
          .
        </p>
      </div>
    </Frame>
  )
}
