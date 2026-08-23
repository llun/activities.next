import {
  Context,
  ContextManager,
  ROOT_CONTEXT,
  Span,
  SpanContext,
  SpanOptions,
  SpanStatus,
  SpanStatusCode,
  TraceFlags,
  Tracer,
  TracerProvider,
  context,
  trace
} from '@opentelemetry/api'
import { AsyncLocalStorage } from 'node:async_hooks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { withSpan } from './trace'

class AsyncLocalStorageContextManager implements ContextManager {
  private _storage = new AsyncLocalStorage<Context>()

  active(): Context {
    return this._storage.getStore() ?? ROOT_CONTEXT
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    ctx: Context,
    fn: (...args: A) => ReturnType<F>,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this._storage.run(ctx, () => fn.apply(thisArg, args))
  }

  bind<T>(_context: Context, target: T): T {
    return target
  }

  enable(): this {
    return this
  }

  disable(): this {
    this._storage.disable()
    return this
  }
}

// Minimal in-memory tracer that records spans for assertion without an SDK.
interface RecordedSpan {
  name: string
  spanId: string
  parentSpanId?: string
  attributes: Record<string, unknown>
  status?: SpanStatus
  exception?: Error
  ended: boolean
}

function createFakeTracerProvider() {
  const recordedSpans: RecordedSpan[] = []
  let spanIdCounter = 0

  class FakeSpan implements Span {
    readonly spanContextValue: SpanContext
    private _rec: RecordedSpan

    constructor(name: string, options?: SpanOptions, parentContext?: Context) {
      const parentSpan = parentContext
        ? trace.getSpan(parentContext)
        : undefined
      const id = String(++spanIdCounter).padStart(16, '0')
      this.spanContextValue = {
        traceId:
          parentSpan?.spanContext().traceId ??
          '11111111111111111111111111111111',
        spanId: id,
        traceFlags: TraceFlags.SAMPLED
      }
      this._rec = {
        name,
        spanId: id,
        parentSpanId: parentSpan?.spanContext().spanId,
        attributes: { ...(options?.attributes ?? {}) },
        ended: false
      }
      recordedSpans.push(this._rec)
    }

    spanContext(): SpanContext {
      return this.spanContextValue
    }
    setAttribute(key: string, value: unknown): this {
      this._rec.attributes[key] = value
      return this
    }
    setAttributes(attributes: Record<string, unknown>): this {
      Object.assign(this._rec.attributes, attributes)
      return this
    }
    addEvent(): this {
      return this
    }
    addLink(): this {
      return this
    }
    addLinks(): this {
      return this
    }
    setStatus(status: SpanStatus): this {
      this._rec.status = status
      return this
    }
    updateName(name: string): this {
      this._rec.name = name
      return this
    }
    end(): void {
      this._rec.ended = true
    }
    isRecording(): boolean {
      return true
    }
    recordException(exception: Error): void {
      this._rec.exception = exception
    }
  }

  class FakeTracer implements Tracer {
    startSpan(name: string, options?: SpanOptions, ctx?: Context): Span {
      return new FakeSpan(name, options, ctx ?? context.active())
    }
    startActiveSpan<F extends (span: Span) => unknown>(
      name: string,
      optionsOrFn: SpanOptions | F,
      contextOrFn?: Context | F,
      maybeFn?: F
    ): ReturnType<F> {
      let fn: F
      let options: SpanOptions | undefined
      let ctx: Context | undefined

      if (typeof optionsOrFn === 'function') {
        fn = optionsOrFn
      } else if (typeof contextOrFn === 'function') {
        fn = contextOrFn
        options = optionsOrFn
      } else {
        fn = maybeFn!
        options = optionsOrFn
        ctx = contextOrFn
      }

      const activeCtx = ctx ?? context.active()
      const span = new FakeSpan(name, options, activeCtx)
      const newCtx = trace.setSpan(activeCtx, span)
      return context.with(newCtx, () => fn(span)) as ReturnType<F>
    }
  }

  const provider: TracerProvider = {
    getTracer: () => new FakeTracer()
  }

  return { provider, recordedSpans }
}

describe('withSpan', () => {
  let recordedSpans: RecordedSpan[]

  beforeEach(() => {
    const contextManager = new AsyncLocalStorageContextManager()
    contextManager.enable()
    context.setGlobalContextManager(contextManager)
    const fake = createFakeTracerProvider()
    trace.setGlobalTracerProvider(fake.provider)
    recordedSpans = fake.recordedSpans
  })

  afterEach(() => {
    trace.disable()
    context.disable()
  })

  it('runs fn, sets attributes, and ends span on success', async () => {
    const result = await withSpan(
      'actions',
      'testOp',
      { key: 'val' },
      async (span) => {
        span.setAttribute('extra', 42)
        return 'success'
      }
    )

    expect(result).toBe('success')
    expect(recordedSpans).toHaveLength(1)
    expect(recordedSpans[0].name).toBe('actions.testOp')
    expect(recordedSpans[0].attributes).toEqual({ key: 'val', extra: 42 })
    expect(recordedSpans[0].ended).toBe(true)
    expect(recordedSpans[0].exception).toBeUndefined()
  })

  it('nests child spans under parent when called inside withSpan', async () => {
    await withSpan('parent', 'outer', {}, async () => {
      await withSpan('child', 'inner', {}, async () => {
        return 'child done'
      })
    })

    expect(recordedSpans).toHaveLength(2)
    const [outer, inner] = recordedSpans
    expect(outer.name).toBe('parent.outer')
    expect(inner.name).toBe('child.inner')
    expect(inner.parentSpanId).toBe(outer.spanId)
  })

  it('records exception, sets status ERROR, ends span, and rethrows on failure', async () => {
    const err = new Error('boom')

    await expect(
      withSpan('actions', 'failingOp', {}, async () => {
        throw err
      })
    ).rejects.toThrow('boom')

    expect(recordedSpans).toHaveLength(1)
    expect(recordedSpans[0].name).toBe('actions.failingOp')
    expect(recordedSpans[0].ended).toBe(true)
    expect(recordedSpans[0].exception).toBe(err)
    expect(recordedSpans[0].status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'Error: boom'
    })
  })
})
