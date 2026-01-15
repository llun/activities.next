import {
  TRACE_APPLICATION_SCOPE,
  TRACE_APPLICATION_VERSION,
  Trace,
  getSpan,
  getTracer
} from './trace'

describe('trace utilities', () => {
  describe('TRACE constants', () => {
    it('exports APPLICATION_SCOPE', () => {
      expect(TRACE_APPLICATION_SCOPE).toBe('activities.next')
    })

    it('exports APPLICATION_VERSION', () => {
      expect(TRACE_APPLICATION_VERSION).toBeDefined()
    })
  })

  describe('getTracer', () => {
    it('returns a tracer', () => {
      const tracer = getTracer()
      expect(tracer).toBeDefined()
    })
  })

  describe('getSpan', () => {
    it('creates a span with op and name', () => {
      const span = getSpan('test', 'operation')

      expect(span).toBeDefined()
      span.end()
    })

    it('creates a span with data attributes', () => {
      const span = getSpan('test', 'operation', {
        key: 'value',
        num: 123,
        bool: true
      })

      expect(span).toBeDefined()
      span.end()
    })
  })

  describe('Trace decorator', () => {
    it('wraps async function with tracing', async () => {
      class TestClass {
        @Trace('test')
        async asyncMethod() {
          return 'async result'
        }
      }

      const instance = new TestClass()
      const result = await instance.asyncMethod()

      expect(result).toBe('async result')
    })

    it('wraps sync function with tracing', () => {
      class TestClass {
        @Trace('test')
        syncMethod() {
          return 'sync result'
        }
      }

      const instance = new TestClass()
      const result = instance.syncMethod()

      expect(result).toBe('sync result')
    })
  })
})
