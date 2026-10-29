import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Post rows use `content-visibility: auto` (see app/globals.css), whose
// containment clips non-portaled overlays and makes the row the containing
// block of every `fixed` descendant. So any `fixed` element, and any `absolute`
// one with a `top-full`/`bottom-full`/`left-full`/`right-full` offset, must carry
// a bare `data-row-overlay` (on an element rendered only while open) or be
// portaled. `data-row-overlay={open}` is flagged: React renders
// `data-row-overlay="false"`, which still matches `[data-row-overlay]`.
// This scan judges each opening tag alone and is NOT a full audit. Known limits:
// arbitrary offsets (`top-[calc(100%+4px)]`), `-translate-y-full`, static-position
// or margin placement (`absolute mt-2` dropdowns), numeric or negative offsets
// (`absolute -top-10`), and classes built outside the tag (a constant, a helper)
// are not seen. A regex literal containing `/*` (e.g. `/\/*$/`) is read as a
// block comment by the comment stripper.
const root = fileURLToPath(new URL('..', import.meta.url))
const ROOTS = ['lib/components/posts', 'lib/components/post-box']

// "file :: className fragment" -> reason it is safe.
const ALLOWED = new Map<string, string>([
  [
    'lib/components/posts/reply-toast.tsx :: ',
    'rendered by status-thread.tsx and MainPageTimeline.tsx outside rows'
  ]
])

const collect = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) return collect(p)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
      ? [p]
      : []
  })

/**
 * Index of the character after the string or template literal that starts at
 * `i` (a quote or backtick). Template `${...}` parts are skipped balanced.
 */
const skipString = (code: string, i: number): number => {
  const quote = code[i]
  let j = i + 1
  while (j < code.length) {
    const c = code[j]
    if (c === '\\') j += 2
    else if (c === quote) return j + 1
    else if (quote === '`' && c === '$' && code[j + 1] === '{')
      j = skipBraces(code, j + 1)
    else j++
  }
  throw new Error(`Unterminated string at offset ${i}`)
}

/**
 * Index after the quoted string (`'` or `"`) at `i` when it closes on the same
 * line, else `i + 1`: an unmatched quote is JSX text such as an apostrophe.
 */
const skipQuoted = (code: string, i: number): number => {
  const quote = code[i]
  for (let j = i + 1; j < code.length; j++) {
    const c = code[j]
    if (c === '\\') j++
    else if (c === quote) return j + 1
    else if (c === '\n') break
  }
  return i + 1
}

/**
 * `source` with `//` and block comments replaced by spaces (newlines kept), so
 * offsets stay stable. String and template literals are walked past, so a
 * `/*` or ` // ` inside one is not read as a comment.
 */
const withoutComments = (source: string) => {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    let end = i + 1
    if (c === '"' || c === "'") end = skipQuoted(source, i)
    else if (c === '`') {
      try {
        end = skipString(source, i)
      } catch {
        end = i + 1
      }
    } else if (c === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2)
      end = close === -1 ? source.length : close + 2
      out += source.slice(i, end).replace(/[^\n]/g, ' ')
      i = end
      continue
    } else if (c === '/' && next === '/' && source[i - 1] !== ':') {
      const nl = source.indexOf('\n', i)
      end = nl === -1 ? source.length : nl
      out += ' '.repeat(end - i)
      i = end
      continue
    }
    out += source.slice(i, end)
    i = end
  }
  return out
}

/** Index after the `{...}` group that starts at `i`, skipping strings. */
const skipBraces = (code: string, i: number): number => {
  let depth = 0
  let j = i
  while (j < code.length) {
    const c = code[j]
    if (c === '"' || c === "'") {
      j = skipQuoted(code, j)
      continue
    }
    if (c === '`') {
      j = skipString(code, j)
      continue
    }
    if (c === '{') depth++
    else if (c === '}' && --depth === 0) return j + 1
    j++
  }
  throw new Error(`Unbalanced braces at offset ${i}`)
}

/** Index after the `(...)` group that starts at `i`, skipping strings. */
const skipParens = (code: string, i: number): number => {
  let depth = 0
  let j = i
  while (j < code.length) {
    const c = code[j]
    if (c === '"' || c === "'") {
      j = skipQuoted(code, j)
      continue
    }
    if (c === '`') {
      j = skipString(code, j)
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return j + 1
    j++
  }
  throw new Error(`Unbalanced parentheses at offset ${i}`)
}

type Tag = { text: string; start: number }

/**
 * Every JSX opening tag: from `<Name` to the closing `>` at brace depth 0,
 * tracking `{}` nesting and string/template literals. A tag that does not close
 * throws instead of being skipped.
 */
const openingTags = (code: string): Tag[] => {
  const tags: Tag[] = []
  for (let i = 0; i < code.length; i++) {
    // `<` after an identifier is a TypeScript generic or comparison, not JSX.
    if (code[i] !== '<' || !/[A-Za-z]/.test(code[i + 1] ?? '')) continue
    if (/[\w$)\]]/.test(code[i - 1] ?? '')) continue
    let j = i + 1
    for (;;) {
      if (j >= code.length) throw new Error(`Unclosed tag at offset ${i}`)
      const c = code[j]
      if (c === '"' || c === "'") j = skipQuoted(code, j)
      else if (c === '`') j = skipString(code, j)
      else if (c === '{') j = skipBraces(code, j)
      else if (c === '>') break
      else j++
    }
    tags.push({ text: code.slice(i, j + 1), start: i })
  }
  return tags
}

/**
 * Source ranges that end up portaled: the first argument of `createPortal(...)`
 * (inline JSX), or, when it is a variable, that variable's initializer.
 */
const portalRanges = (code: string): Array<[number, number]> => {
  const ranges: Array<[number, number]> = []
  for (const m of code.matchAll(/\bcreatePortal\s*\(/g)) {
    const open = m.index + m[0].length - 1
    const end = skipParens(code, open)
    const arg = code
      .slice(open + 1, end - 1)
      .match(/^\s*([A-Za-z_$][\w$]*)\s*,/)
    if (!arg) {
      ranges.push([open, end])
      continue
    }
    // Limits: finds the first `const`/`let` of that name in the file, and only a
    // parenthesised JSX initializer; anything else throws instead of passing.
    const decl = new RegExp(`\\b(?:const|let)\\s+${arg[1]}\\b[^=]*=\\s*`).exec(
      code
    )
    if (!decl) throw new Error(`Cannot find the portaled value ${arg[1]}`)
    const from = decl.index + decl[0].length
    if (code[from] === '(') ranges.push([from, skipParens(code, from)])
    else throw new Error(`Cannot delimit the portaled value ${arg[1]}`)
  }
  return ranges
}

/** The whole opening tag with whitespace collapsed (readable offender key). */
const normalizedTag = (tag: string) => tag.replace(/\s+/g, ' ')

/** Tailwind classes (with variants) present in the tag, e.g. `max-md:fixed`. */
const classes = (tag: string) => tag.split(/[\s"'`{}]+/)

const base = (cls: string) =>
  (cls.split(':').pop() ?? cls).replace(/^!/, '').replace(/!$/, '')

/**
 * True when the tag positions itself so it can reach outside the row: any
 * `fixed` (the row is its containing block), or `absolute` with a `*-full`
 * offset.
 */
const isOverflowingOverlay = (tag: string) => {
  const bases = classes(tag).map(base)
  if (bases.includes('fixed')) return true
  return (
    bases.includes('absolute') &&
    bases.some((c) => /^-?(?:top|bottom|left|right|start|end)-full$/.test(c))
  )
}

/** Unmarked, non-portaled overlay tags of `code`, as readable keys. */
export const findUnmarkedOverlays = (rel: string, source: string) => {
  const code = withoutComments(source)
  const portaled = portalRanges(code)
  const offenders: string[] = []
  for (const tag of openingTags(code)) {
    if (/\bdata-row-overlay\s*=/.test(tag.text)) {
      offenders.push(
        `${rel} :: use a bare data-row-overlay on a conditionally rendered element: ${normalizedTag(tag.text).slice(0, 80)}`
      )
      continue
    }
    if (!isOverflowingOverlay(tag.text)) continue
    if (/\bdata-row-overlay(?![\w-])/.test(tag.text)) continue
    if (portaled.some(([a, b]) => tag.start >= a && tag.start < b)) continue
    const key = `${rel} :: ${normalizedTag(tag.text).slice(0, 80)}`
    if ([...ALLOWED.keys()].some((k) => key.startsWith(k))) continue
    offenders.push(key)
  }
  return offenders
}

describe('post row overlays', () => {
  const files = ROOTS.flatMap((dir) => collect(path.join(root, dir)))

  it('has files to scan', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('flags unmarked absolute/fixed overlays it can recognize', () => {
    const offenders = files.flatMap((file) => {
      const rel = path.relative(root, file)
      try {
        return findUnmarkedOverlays(rel, readFileSync(file, 'utf8'))
      } catch (error) {
        throw new Error(
          `${rel}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error }
        )
      }
    })
    expect(offenders).toEqual([])
  })

  describe('scanner', () => {
    it('flags unmarked overlays and accepts marked or portaled ones', () => {
      const unmarked = `const a = <div className={cn('absolute top-full left-0', open && 'x')}>{items.map((i) => ({ a: { b: { c: i } } }))}</div>`
      expect(findUnmarkedOverlays('x.tsx', unmarked)).toHaveLength(1)

      const marked = `const a = <div data-row-overlay className="absolute bottom-full">x</div>`
      expect(findUnmarkedOverlays('x.tsx', marked)).toEqual([])

      const responsive = `<div className="max-md:fixed max-md:inset-0">x</div>`
      expect(findUnmarkedOverlays('x.tsx', responsive)).toHaveLength(1)

      const deep = `<div onClick={() => f({ a: { b: { c: { d: 1 } } } })} className="absolute right-full">x</div>`
      expect(findUnmarkedOverlays('x.tsx', deep)).toHaveLength(1)

      const inside = `<div className="absolute inset-0 bg-black/40">x</div>`
      expect(findUnmarkedOverlays('x.tsx', inside)).toEqual([])

      const mixed = `const c = (<div className="absolute top-full">a</div>)
        const d = <div className="fixed inset-0">b</div>
        createPortal(c, document.body)`
      expect(findUnmarkedOverlays('x.tsx', mixed)).toHaveLength(1)

      const fixedAlone = `<div className="fixed bottom-4 right-4">x</div>`
      expect(findUnmarkedOverlays('x.tsx', fixedAlone)).toHaveLength(1)

      const valued = `<div data-row-overlay={open} className="absolute top-full">x</div>`
      expect(findUnmarkedOverlays('x.tsx', valued)).toHaveLength(1)

      const stringy = `const P = '/api/*'
        const a = <div className="absolute top-full">x</div>
        /* doc */
        const q = ' // x'; const z = <div className="fixed">z</div>
        const b = <div className="fixed inset-0">y</div>`
      expect(findUnmarkedOverlays('x.tsx', stringy)).toHaveLength(3)

      const commented = `// <div className="fixed inset-0">
        /* <div className="absolute top-full"> */
        const t = <p>don't</p>`
      expect(findUnmarkedOverlays('x.tsx', commented)).toEqual([])

      const apostrophe = `<Foo fallback={<p>Couldn't load</p>} className="x">a</Foo>
        <div className="fixed inset-0">y</div>`
      expect(findUnmarkedOverlays('x.tsx', apostrophe)).toHaveLength(1)

      const important = `<div className="absolute! top-full">x</div><div className="!fixed">y</div><div className="fixed!">z</div><div className="absolute start-full">w</div>`
      expect(findUnmarkedOverlays('x.tsx', important)).toHaveLength(4)

      const anchor = `<div data-row-overlay-anchor className="fixed">x</div>`
      expect(findUnmarkedOverlays('x.tsx', anchor)).toHaveLength(1)

      expect(() => openingTags('<div className="a" {')).toThrow()
    })
  })
})
