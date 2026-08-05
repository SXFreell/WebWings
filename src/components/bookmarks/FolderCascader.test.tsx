// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderNode } from '@/types'
import { FolderCascader } from './FolderCascader'

afterEach(cleanup)

const folder = (id: string, title: string, parentId: string | null, order = 1): FolderNode => ({
  id, title, parentId, order, type: 'folder',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
})

const folders = [
  folder('work', '工作', null),
  folder('frontend', '前端', 'work'),
  folder('react', 'React', 'frontend'),
]

describe('FolderCascader', () => {
  it('shows the selected full path', () => {
    render(<FolderCascader folders={folders} value="react" onValueChange={() => {}} rootLabel="根目录" ariaLabel="上级目录" />)
    expect(screen.getByRole('button', { name: '上级目录：工作 / 前端 / React' })).toBeTruthy()
  })

  it('expands one column for each hovered parent', async () => {
    const user = userEvent.setup()
    render(<FolderCascader folders={folders} value={null} onValueChange={() => {}} rootLabel="根目录" ariaLabel="上级目录" />)

    await user.click(screen.getByRole('button', { name: '上级目录：根目录' }))
    expect(screen.getAllByRole('group', { name: /级目录/ })).toHaveLength(1)

    fireEvent.pointerMove(screen.getByRole('menuitem', { name: /工作/ }))
    expect(screen.getAllByRole('group', { name: /级目录/ })).toHaveLength(2)
    fireEvent.pointerMove(screen.getByRole('menuitem', { name: /前端/ }))
    expect(within(screen.getAllByRole('group', { name: /级目录/ })[2]).getByText('React')).toBeTruthy()
  })

  it('allows selecting a parent that still has children', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(<FolderCascader folders={folders} value={null} onValueChange={onValueChange} rootLabel="未分类" ariaLabel="保存到" />)

    await user.click(screen.getByRole('button', { name: '保存到：未分类' }))
    await user.click(screen.getByRole('menuitem', { name: /工作/ }))
    expect(onValueChange).toHaveBeenCalledWith('work')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('selects the root value and hides excluded folders', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(<FolderCascader folders={folders} value="work" onValueChange={onValueChange} rootLabel="根目录" ariaLabel="上级目录" excludedIds={new Set(['frontend', 'react'])} />)

    await user.click(screen.getByRole('button', { name: '上级目录：工作' }))
    expect(screen.queryByText('前端')).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: '根目录' }))
    expect(onValueChange).toHaveBeenCalledWith(null)
  })
})
