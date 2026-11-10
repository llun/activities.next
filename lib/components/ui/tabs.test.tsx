/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

describe('Tabs', () => {
  it('renders tabs list with rounded-none', () => {
    const { container } = render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>
    )
    const list = container.querySelector('[data-slot="tabs-list"]')
    expect(list).toHaveClass('rounded-none')
  })

  it('renders tabs trigger with rounded-md and active keycap inset shadow', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
      </Tabs>
    )
    const activeTrigger = screen.getByRole('tab', { name: 'Tab 1' })
    expect(activeTrigger).toHaveClass(
      'rounded-md',
      'data-[state=active]:border-input',
      'data-[state=active]:shadow-[inset_0_-2px_0_var(--control-edge)]'
    )
    expect(activeTrigger).not.toHaveClass('data-[state=active]:shadow-sm')
  })

  it('renders two-tone focus ring and forced-colors fallback on trigger', () => {
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        </TabsList>
      </Tabs>
    )
    const trigger = screen.getByRole('tab', { name: 'Tab 1' })
    expect(trigger).toHaveClass(
      'focus-visible:outline-none',
      'focus-visible:border-ring',
      'focus-visible:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring)]',
      'forced-colors:focus-visible:[outline-style:solid]',
      'forced-colors:focus-visible:outline-2',
      'forced-colors:focus-visible:outline-[CanvasText]'
    )
  })
})
