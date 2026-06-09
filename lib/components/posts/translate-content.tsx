'use client'

import {
  AlertTriangle,
  ChevronDown,
  Languages,
  LoaderCircle
} from 'lucide-react'
import { FC, ReactNode } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/lib/components/ui/dropdown-menu'
import { displayLanguageName } from '@/lib/utils/language/displayLanguageName'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'

import {
  StatusTranslation,
  useStatusTranslation,
  useTranslationContext
} from './translation-context'

interface Props {
  statusId: string
  // The status's declared language (ISO 639-1), or null/undefined when unknown.
  // The Translate control is only offered when a language is present.
  language?: string | null
  // The server-rendered original content nodes, shown until translated and
  // again when the viewer toggles back to the original.
  children: ReactNode
  contentClassName?: string
}

interface TargetPickerProps {
  target: string
  options: string[]
  onPick: (code: string) => void
}

// A small "<Language> ▾" trigger that opens a menu of target languages.
const TargetPicker: FC<TargetPickerProps> = ({ target, options, onPick }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="inline-flex min-h-8 -my-1 items-center gap-0.5 rounded-sm py-1 font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {displayLanguageName(target)}
        <ChevronDown className="size-3 shrink-0" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-44">
      <DropdownMenuLabel>Translate to</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={target} onValueChange={onPick}>
        {options.map((code) => (
          <DropdownMenuRadioItem key={code} value={code}>
            {displayLanguageName(code)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
)

/**
 * The "Translate from … → … / Translated from … to … using … · Show original"
 * control. Driven entirely by a status translation state object. Renders
 * nothing when the status cannot be translated.
 */
export const TranslateControl: FC<{ translation: StatusTranslation }> = ({
  translation: t
}) => {
  if (!t.canTranslate) return null
  const {
    state,
    target,
    options,
    detectedSource,
    provider,
    request,
    pickTarget,
    showOriginal
  } = t

  return (
    <div className="mt-1 text-xs">
      {state === 'idle' && (
        <div className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <button
            type="button"
            onClick={() => request()}
            className="inline-flex min-h-8 -my-1 items-center gap-1.5 py-1 font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <Languages className="size-3.5" />
            Translate from {displayLanguageName(detectedSource ?? '')}
          </button>
          {options.length > 1 && target && (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden="true">→</span>
              <TargetPicker
                target={target}
                options={options}
                onPick={pickTarget}
              />
            </span>
          )}
        </div>
      )}

      {state === 'loading' && (
        <span
          className="inline-flex min-h-8 -my-1 items-center gap-1.5 py-1 font-medium text-muted-foreground"
          aria-live="polite"
        >
          <LoaderCircle className="size-3.5 animate-spin" />
          Translating to {displayLanguageName(target ?? '')}…
        </span>
      )}

      {state === 'translated' && (
        <div
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
          aria-live="polite"
        >
          <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-1 text-muted-foreground">
            <Languages className="size-3.5 shrink-0" />
            <span>
              Translated from {displayLanguageName(detectedSource ?? '')} to
            </span>
            {options.length > 1 && target ? (
              <TargetPicker
                target={target}
                options={options}
                onPick={pickTarget}
              />
            ) : (
              <span className="font-medium text-foreground">
                {displayLanguageName(target ?? '')}
              </span>
            )}
            {provider ? (
              <span>
                using{' '}
                <span className="font-medium text-foreground">{provider}</span>
              </span>
            ) : null}
          </span>
          <button
            type="button"
            onClick={showOriginal}
            className="min-h-8 -my-1 py-1 font-medium text-primary transition-colors hover:underline"
          >
            Show original
          </button>
        </div>
      )}

      {state === 'error' && (
        <div
          className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
          aria-live="polite"
        >
          <span className="inline-flex items-center gap-1.5 text-destructive">
            <AlertTriangle className="size-3.5 shrink-0" />
            Couldn&apos;t translate this post
          </span>
          <button
            type="button"
            onClick={() => request()}
            className="min-h-8 -my-1 py-1 font-medium text-primary transition-colors hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

// Renders the body, swapping in the translated HTML when toggled, and appends
// the Translate control. The translated HTML runs through the same
// `cleanClassName` pipeline as the original, so links, mentions and hashtags
// behave identically.
const TranslateContentView: FC<
  Pick<Props, 'children' | 'contentClassName'> & { t: StatusTranslation }
> = ({ t, children, contentClassName }) => {
  if (!t.canTranslate) return <>{children}</>

  return (
    <>
      {t.showingTranslation && t.translation ? (
        <div className={contentClassName}>
          {cleanClassName(t.translation.content)}
        </div>
      ) : (
        children
      )}
      <TranslateControl translation={t} />
    </>
  )
}

// Self-managed variant for stand-alone usages with no surrounding provider.
const StandaloneTranslateContent: FC<Props> = ({
  statusId,
  language,
  ...rest
}) => {
  const t = useStatusTranslation(statusId, language)
  return <TranslateContentView t={t} {...rest} />
}

/**
 * Renders a status' body plus a Mastodon-style Translate control. When wrapped
 * in a `TranslationProvider` it shares that status' translation state (so the
 * poll flips together); otherwise it self-manages with a local state machine so
 * stand-alone usages keep working.
 */
export const TranslateContent: FC<Props> = (props) => {
  const context = useTranslationContext()
  if (context) {
    const { children, contentClassName } = props
    return (
      <TranslateContentView t={context} contentClassName={contentClassName}>
        {children}
      </TranslateContentView>
    )
  }
  return <StandaloneTranslateContent {...props} />
}
