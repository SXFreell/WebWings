# 目录级联选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将收藏、目录和导入对话框中的扁平目录下拉框替换为可选择任意父级的多列级联选择器。

**Architecture:** 在 `bookmark-tree` 中增加纯函数，负责过滤目录、生成稳定排序的级联列和显示路径；新增 `FolderCascader` 作为唯一交互组件，并复用现有 Radix DropdownMenu 的弹层、焦点和关闭行为。三个业务对话框只负责传入各自的根节点文案、当前值及排除集合，不改变持久化数据流。

**Tech Stack:** React 19、TypeScript 5.8、Radix Dropdown Menu、Tailwind CSS 4、Vitest 3、Testing Library、jsdom、pnpm。

## Global Constraints

- 三个入口必须共享一个 `FolderCascader` 组件。
- 悬停带子目录的条目时展开下一列，点击任意目录时立即选中并关闭。
- 收藏空值文案固定为“未分类”；目录和导入空值文案固定为“根目录”。
- 编辑目录时必须隐藏自身和全部后代。
- 导入目标锁定时继续使用只读路径，不启用级联选择器。
- 不修改目录数据模型、数据库结构、保存回调或侧边栏目录树。
- 同级目录继续按 `order`、中文标题排序。

---

## File Structure

- `src/lib/bookmark-tree.ts`：新增可用目录过滤、级联列生成和安全路径显示纯函数。
- `src/lib/bookmark-tree.test.ts`：覆盖级联数据、排除、无效 ID、孤立节点和循环节点。
- `src/components/bookmarks/FolderCascader.tsx`：实现触发器、多列弹层、悬停路径和选择行为。
- `src/components/bookmarks/FolderCascader.test.tsx`：覆盖真实组件的打开、悬停、父级选择、根节点选择和路径显示。
- `src/components/bookmarks/DirectoryDialogs.test.tsx`：验证三个对话框的业务接入和目录编辑排除规则。
- `src/components/bookmarks/BookmarkDialog.tsx`：用级联组件替换目录 Select。
- `src/components/bookmarks/FolderDialog.tsx`：用级联组件替换目录 Select，并传入排除集合。
- `src/components/bookmarks/ImportDialog.tsx`：未锁定目标使用级联组件，锁定目标保留只读展示。
- `package.json`、`pnpm-lock.yaml`：增加组件测试所需的 Testing Library 与 jsdom 开发依赖。

### Task 1: 级联目录数据模型

**Files:**
- Create: `src/lib/bookmark-tree.test.ts`
- Modify: `src/lib/bookmark-tree.ts`

**Interfaces:**
- Consumes: `FolderNode[]`、`Set<string>`、现有 `sortNodes()` 与 `folderPath()`。
- Produces: `availableFolders(folders, excludedIds): FolderNode[]`、`folderCascaderColumns(folders, expandedPathIds): FolderNode[][]`、`folderDisplayPath(folders, id, rootLabel): string`。

- [ ] **Step 1: 写出会因缺少级联数据函数而失败的测试**

```ts
import { describe, expect, it } from 'vitest'
import type { FolderNode } from '@/types'
import { availableFolders, folderCascaderColumns, folderDisplayPath } from './bookmark-tree'

const folder = (id: string, title: string, parentId: string | null, order: number): FolderNode => ({
  id, title, parentId, order, type: 'folder',
  createdAt: '2026-08-05T00:00:00.000Z',
  updatedAt: '2026-08-05T00:00:00.000Z',
})

const folders = [
  folder('work', '工作', null, 2),
  folder('life', '生活', null, 1),
  folder('frontend', '前端', 'work', 1),
  folder('react', 'React', 'frontend', 1),
]

describe('folder cascader data', () => {
  it('builds one sorted column per expanded level', () => {
    expect(folderCascaderColumns(folders, ['work', 'frontend']).map((column) => column.map((item) => item.id)))
      .toEqual([['life', 'work'], ['frontend'], ['react']])
  })

  it('uses a literal full path and falls back to the root label for an invalid id', () => {
    expect(folderDisplayPath(folders, 'react', '根目录')).toBe('工作 / 前端 / React')
    expect(folderDisplayPath(folders, 'missing', '根目录')).toBe('根目录')
    expect(folderDisplayPath(folders, null, '未分类')).toBe('未分类')
  })

  it('removes excluded folders so their descendants cannot appear in columns', () => {
    const visible = availableFolders(folders, new Set(['work', 'frontend', 'react']))
    expect(folderCascaderColumns(visible, ['work']).flat().map((item) => item.id)).toEqual(['life'])
  })

  it('ignores orphaned and cyclic paths without looping', () => {
    const malformed = [
      ...folders,
      folder('orphan', '孤立', 'missing', 1),
      folder('cycle-a', '循环 A', 'cycle-b', 1),
      folder('cycle-b', '循环 B', 'cycle-a', 1),
    ]
    expect(folderDisplayPath(malformed, 'orphan', '根目录')).toBe('孤立')
    expect(folderDisplayPath(malformed, 'cycle-a', '根目录')).toMatch(/循环 A/)
  })
})
```

- [ ] **Step 2: 运行测试并确认因导出函数不存在而失败**

Run: `pnpm test -- src/lib/bookmark-tree.test.ts`

Expected: FAIL，错误包含 `does not provide an export named 'availableFolders'` 或等价的缺少导出信息。

- [ ] **Step 3: 实现最小纯函数**

在 `src/lib/bookmark-tree.ts` 增加：

```ts
export const availableFolders = (folders: FolderNode[], excludedIds = new Set<string>()) => (
  folders.filter((folder) => !excludedIds.has(folder.id))
)

export const folderCascaderColumns = (folders: FolderNode[], expandedPathIds: string[]) => {
  const columns: FolderNode[][] = [sortNodes(folders.filter((folder) => folder.parentId === null))]
  const visited = new Set<string>()
  for (const id of expandedPathIds) {
    if (visited.has(id)) break
    visited.add(id)
    const children = sortNodes(folders.filter((folder) => folder.parentId === id))
    if (!children.length) break
    columns.push(children)
  }
  return columns
}

export const folderDisplayPath = (folders: FolderNode[], id: string | null, rootLabel: string) => {
  if (!id) return rootLabel
  const path = folderPath(folders, id)
  return path.length ? path.map((folder) => folder.title).join(' / ') : rootLabel
}
```

- [ ] **Step 4: 运行局部测试并确认通过**

Run: `pnpm test -- src/lib/bookmark-tree.test.ts`

Expected: PASS，4 个级联数据测试全部通过。

- [ ] **Step 5: 运行现有目录相关测试并提交**

Run: `pnpm test -- src/lib/bookmark-tree.test.ts src/lib/bookmarks-db.test.ts`

Expected: PASS，无警告或未处理异常。

```bash
git add src/lib/bookmark-tree.ts src/lib/bookmark-tree.test.ts
git commit -m "test: define folder cascader data behavior"
```

### Task 2: 可复用多列级联组件

**Files:**
- Create: `src/components/bookmarks/FolderCascader.tsx`
- Create: `src/components/bookmarks/FolderCascader.test.tsx`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `availableFolders()`、`folderCascaderColumns()`、`folderDisplayPath()`、`folderPath()`。
- Produces: `FolderCascader(props)`，其中 `props` 为 `{ folders: FolderNode[]; value: string | null; onValueChange(value: string | null): void; rootLabel: string; ariaLabel: string; excludedIds?: Set<string>; disabled?: boolean }`。

- [ ] **Step 1: 安装真实 DOM 组件测试依赖**

Run: `pnpm add -D @testing-library/react @testing-library/user-event jsdom`

Expected: `package.json` 和 `pnpm-lock.yaml` 只增加上述开发依赖及其传递依赖。

- [ ] **Step 2: 写出会因组件不存在而失败的交互测试**

创建 `src/components/bookmarks/FolderCascader.test.tsx`：

```tsx
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
```

- [ ] **Step 3: 运行测试并确认因组件缺失而失败**

Run: `pnpm test -- src/components/bookmarks/FolderCascader.test.tsx`

Expected: FAIL，错误包含 `Cannot find module './FolderCascader'`。

- [ ] **Step 4: 实现触发器、初始路径和多列弹层**

创建 `src/components/bookmarks/FolderCascader.tsx`，核心结构必须如下：

```tsx
import { useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { availableFolders, folderCascaderColumns, folderDisplayPath, folderPath } from '@/lib/bookmark-tree'
import { cn } from '@/lib/utils'
import type { FolderNode } from '@/types'

interface FolderCascaderProps {
  folders: FolderNode[]
  value: string | null
  onValueChange: (value: string | null) => void
  rootLabel: string
  ariaLabel: string
  excludedIds?: Set<string>
  disabled?: boolean
}

export function FolderCascader({ folders, value, onValueChange, rootLabel, ariaLabel, excludedIds = new Set(), disabled }: FolderCascaderProps) {
  const visibleFolders = useMemo(() => availableFolders(folders, excludedIds), [folders, excludedIds])
  const selectedPath = useMemo(() => folderPath(visibleFolders, value).map((folder) => folder.id), [visibleFolders, value])
  const [open, setOpen] = useState(false)
  const [expandedPath, setExpandedPath] = useState<string[]>(selectedPath)
  const columns = folderCascaderColumns(visibleFolders, expandedPath)
  const displayPath = folderDisplayPath(visibleFolders, value, rootLabel)

  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen) setExpandedPath(selectedPath)
    setOpen(nextOpen)
  }

  const expandAt = (columnIndex: number, folderId: string) => {
    setExpandedPath((current) => [...current.slice(0, columnIndex), folderId])
  }

  const select = (nextValue: string | null) => {
    onValueChange(nextValue)
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" aria-label={`${ariaLabel}：${displayPath}`} className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50">
          <span className="truncate">{displayPath}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[480px] overflow-x-auto p-0">
        <div className="flex divide-x divide-border">
          {columns.map((column, columnIndex) => (
            <div key={columnIndex} role="group" aria-label={`第 ${columnIndex + 1} 级目录`} className="max-h-64 w-40 shrink-0 overflow-y-auto p-1">
              {columnIndex === 0 && (
                <DropdownMenuItem onSelect={() => select(null)}>
                  <Folder />{rootLabel}{value === null && <Check className="ml-auto" />}
                </DropdownMenuItem>
              )}
              {column.map((folder) => {
                const hasChildren = visibleFolders.some((item) => item.parentId === folder.id)
                return (
                  <DropdownMenuItem key={folder.id} onPointerMove={() => hasChildren && expandAt(columnIndex, folder.id)} onSelect={() => select(folder.id)} className={cn(expandedPath[columnIndex] === folder.id && 'bg-accent')}>
                    <Folder /><span className="min-w-0 flex-1 truncate">{folder.title}</span>
                    {value === folder.id ? <Check /> : hasChildren ? <ChevronRight /> : null}
                  </DropdownMenuItem>
                )
              })}
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 5: 运行交互测试，按真实 Radix DOM 行为修正事件细节**

Run: `pnpm test -- src/components/bookmarks/FolderCascader.test.tsx`

Expected: PASS；测试必须通过真实的 `FolderCascader` 和 Radix DOM，不能 mock 组件或 DropdownMenu。

- [ ] **Step 6: 运行组件测试与构建并提交**

Run: `pnpm test -- src/lib/bookmark-tree.test.ts src/components/bookmarks/FolderCascader.test.tsx && pnpm build`

Expected: 测试 PASS；TypeScript 和 Vite 构建成功，无可访问性属性类型错误。

```bash
git add package.json pnpm-lock.yaml src/components/bookmarks/FolderCascader.tsx src/components/bookmarks/FolderCascader.test.tsx
git commit -m "feat: add reusable folder cascader"
```

### Task 3: 接入三个业务对话框

**Files:**
- Create: `src/components/bookmarks/DirectoryDialogs.test.tsx`
- Modify: `src/components/bookmarks/BookmarkDialog.tsx`
- Modify: `src/components/bookmarks/FolderDialog.tsx`
- Modify: `src/components/bookmarks/ImportDialog.tsx`

**Interfaces:**
- Consumes: Task 2 的 `FolderCascader` 公共属性接口。
- Produces: 三个对话框保持现有 props 与保存回调签名不变，只替换目录选择 UI。

- [ ] **Step 1: 写出三处接入的失败测试**

创建 `src/components/bookmarks/DirectoryDialogs.test.tsx`，使用真实对话框和级联组件：

```tsx
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
```

- [ ] **Step 2: 运行接入测试并确认旧 Select 语义导致失败**

Run: `pnpm test -- src/components/bookmarks/DirectoryDialogs.test.tsx`

Expected: FAIL，找不到带有 `保存到：未分类`、`上级目录：根目录` 或 `导入到：根目录` 可访问名称的按钮。

- [ ] **Step 3: 替换收藏和目录对话框中的 Select**

在 `BookmarkDialog.tsx` 删除 `Select`、`ROOT_FOLDER`、`flattenFolders` 导入，加入：

```tsx
import { FolderCascader } from '@/components/bookmarks/FolderCascader'
```

将“保存到”控件替换为：

```tsx
<FolderCascader
  folders={folders}
  value={parentId}
  onValueChange={setParentId}
  rootLabel="未分类"
  ariaLabel="保存到"
/>
```

在 `FolderDialog.tsx` 保留 `getDescendantFolderIds`，删除 `Select`、`ROOT_FOLDER`、`flattenFolders` 导入并加入 `FolderCascader`。将“上级目录”控件替换为：

```tsx
<FolderCascader
  folders={folders}
  value={parentId}
  onValueChange={setParentId}
  rootLabel="根目录"
  ariaLabel="上级目录"
  excludedIds={excluded}
/>
```

- [ ] **Step 4: 替换未锁定的导入目标 Select**

在 `ImportDialog.tsx` 删除 `Select`、`ROOT_FOLDER`、`flattenFolders` 导入，加入 `FolderCascader`。锁定分支保持不变，未锁定分支替换为：

```tsx
<FolderCascader
  folders={folders}
  value={targetId}
  onValueChange={setTargetId}
  rootLabel="根目录"
  ariaLabel="导入到"
/>
```

- [ ] **Step 5: 运行接入测试并确认通过**

Run: `pnpm test -- src/components/bookmarks/DirectoryDialogs.test.tsx`

Expected: PASS，三个测试分别验证根文案、编辑排除与导入锁定。

- [ ] **Step 6: 运行全部自动化验证**

Run: `pnpm test && pnpm build`

Expected: 全部 Vitest 测试 PASS；`tsc -b` 与 Vite 构建成功；输出无 React act 警告、未处理 Promise 或 TypeScript 错误。

- [ ] **Step 7: 人工验收固定尺寸扩展 UI**

Run: `pnpm dev --host 127.0.0.1`

在 760×580 页面中逐项检查：

1. 收藏对话框从“未分类”进入“工作 / 前端 / React”，悬停逐列展开，点击“工作”可直接保存到父级。
2. 新建目录可以选择根目录或任意父级；编辑“工作”时看不到“工作”和它的后代。
3. 设置页导入显示可编辑的“根目录”级联选择；从具体目录发起导入时保持只读完整路径。
4. 深层目录横向滚动、长标题截断、每列纵向滚动正常；Escape 和外部点击关闭弹层。
5. 重新打开选择器时，当前完整路径自动展开并显示勾选。

- [ ] **Step 8: 提交三处接入**

```bash
git add src/components/bookmarks/BookmarkDialog.tsx src/components/bookmarks/FolderDialog.tsx src/components/bookmarks/ImportDialog.tsx src/components/bookmarks/DirectoryDialogs.test.tsx
git commit -m "feat: use cascader for directory selection"
```
