// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addNodesAtomically } from '@/lib/bookmarks-db'
import type { BookmarkNode, FolderNode } from '@/types'
import { OptionsApp } from './OptionsApp'

const timestamp = '2026-08-06T00:00:00.000Z'

const folder = (id: string): FolderNode => ({
  id,
  type: 'folder',
  parentId: null,
  title: id,
  order: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
})

const bookmark = (id: string): BookmarkNode => ({
  id,
  type: 'bookmark',
  parentId: null,
  title: id,
  url: `https://${id}.example`,
  order: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
})

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('webwings')
  request.onsuccess = () => resolve()
  request.onerror = () => reject(request.error)
})

describe('OptionsApp', () => {
  beforeEach(async () => {
    await deleteDatabase()
    await addNodesAtomically([
      folder('folder-1'),
      folder('folder-2'),
      bookmark('bookmark-1'),
      bookmark('bookmark-2'),
      bookmark('bookmark-3'),
    ])
  })

  afterEach(cleanup)

  it('renders the persistent settings page with current bookmark counts', async () => {
    render(<OptionsApp />)

    await waitFor(() => expect(screen.getByText('2 个目录，3 条收藏')).toBeTruthy())

    expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('云端同步')).toBeTruthy()
    expect(screen.getByText('数据管理')).toBeTruthy()
  })

  it('lays out the settings page for full viewport scrolling without a clipping card', () => {
    const { container } = render(<OptionsApp />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('min-h-screen')
    expect(root.className).toContain('w-full')
    const clipped = Array.from(container.querySelectorAll<HTMLElement>('[class*="overflow-hidden"]'))
    expect(clipped.some((el) => el.className.includes('min-h-'))).toBe(false)
  })

  it('opens an import dialog that targets the root by default', async () => {
    const user = userEvent.setup()
    render(<OptionsApp />)

    await user.click(await screen.findByRole('button', { name: '导入' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导入到：根目录' })).toBeTruthy()
  })
})
