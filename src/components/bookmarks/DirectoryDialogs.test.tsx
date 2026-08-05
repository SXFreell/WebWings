// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderNode } from '@/types'
import { BookmarkDialog } from './BookmarkDialog'
import { FolderDialog } from './FolderDialog'
import { ImportDialog } from './ImportDialog'

afterEach(cleanup)

const folder = (id: string, title: string, parentId: string | null): FolderNode => ({
  id, title, parentId, order: 1, type: 'folder',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
})

const folders = [folder('work', '工作', null), folder('child', '子目录', 'work'), folder('other', '其他', null)]
const onOpenChange = vi.fn()

describe('directory dialog cascaders', () => {
  it('uses 未分类 as the bookmark root label', () => {
    render(<BookmarkDialog open initial={null} folders={folders} defaultParentId={null} onOpenChange={onOpenChange} onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: '保存到：未分类' })).toBeTruthy()
  })

  it('excludes the edited folder and all descendants from parent choices', async () => {
    const user = userEvent.setup()
    render(<FolderDialog open initial={folders[0]} folders={folders} defaultParentId={null} onOpenChange={onOpenChange} onSave={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '上级目录：根目录' }))
    expect(screen.queryByText('工作')).toBeNull()
    expect(screen.queryByText('子目录')).toBeNull()
    expect(screen.getByText('其他')).toBeTruthy()
  })

  it('uses an unlocked cascader but keeps locked import targets read-only', () => {
    const { rerender } = render(<ImportDialog open folders={folders} initialTargetId={null} targetLocked={false} onOpenChange={onOpenChange} onImport={vi.fn()} />)
    expect(screen.getByRole('button', { name: '导入到：根目录' })).toBeTruthy()

    rerender(<ImportDialog open folders={folders} initialTargetId="child" targetLocked onOpenChange={onOpenChange} onImport={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /导入到：/ })).toBeNull()
    expect(screen.getByText('工作 / 子目录')).toBeTruthy()
  })
})
