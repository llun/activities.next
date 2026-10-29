import * as kit from './index'

describe('surface kit index', () => {
  it.each([
    'AddBar',
    'Alert',
    'EmptyState',
    'FormRow',
    'formRowHintId',
    'formRowLabelId',
    'Frame',
    'FormGroup',
    'FramedList',
    'FramedListItem',
    'RadioCard',
    'SaveBar',
    'SavedIndicator',
    'Section',
    'DescriptionSkeleton',
    'ScreenSkeleton',
    'StatStripSkeleton',
    'SectionSkeleton',
    'SegmentedControl',
    'SkeletonBar',
    'SkeletonRows',
    'StatCell',
    'StatStrip',
    'TableFrame',
    'TABLE_HEAD_ROW_CLASS'
  ])('exports %s', (name) => {
    expect((kit as Record<string, unknown>)[name]).toBeDefined()
  })
})
