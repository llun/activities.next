/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Tabs, TabsList, TabsTrigger } from './tabs'

describe('Tabs', () => {
  it('gives each trigger 16 px of side padding', () => {
    render(
      <Tabs defaultValue="posts">
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="replies">Replies</TabsTrigger>
        </TabsList>
      </Tabs>
    )
    const trigger = screen.getByRole('tab', { name: 'Posts' })
    expect(trigger).toHaveClass('px-4')
    expect(trigger).not.toHaveClass('px-2')
  })
})
