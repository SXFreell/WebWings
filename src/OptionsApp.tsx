import { useCallback, useEffect, useMemo, useState } from 'react'
import { ImportDialog } from '@/components/bookmarks/ImportDialog'
import { SettingsView } from '@/components/bookmarks/SettingsView'
import { exportBookmarks, getAllNodes, mergeImport } from '@/lib/bookmarks-db'
import { onLocalChange } from '@/lib/sync/notify'
import type { FavoriteNode, FolderNode } from '@/types'

const dateSuffix = () => new Date().toISOString().slice(0, 10)

const downloadPayload = (payload: Awaited<ReturnType<typeof exportBookmarks>>, filename: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

export function OptionsApp() {
  const [nodes, setNodes] = useState<FavoriteNode[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const folders = useMemo(
    () => nodes.filter((node): node is FolderNode => node.type === 'folder'),
    [nodes],
  )
  const bookmarkCount = nodes.filter((node) => node.type === 'bookmark').length

  const reload = useCallback(async () => {
    setNodes(await getAllNodes())
  }, [])

  useEffect(() => {
    void reload()
    return onLocalChange(() => { void reload() })
  }, [reload])

  const exportAll = async () => {
    const payload = await exportBookmarks()
    downloadPayload(payload, `webwings-bookmarks-${dateSuffix()}.json`)
  }

  const importData = async (payload: Awaited<ReturnType<typeof exportBookmarks>>) => {
    await mergeImport(payload, null)
    await reload()
  }

  return (
    <div className="min-h-screen w-full bg-muted/30 px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <SettingsView
          folderCount={folders.length}
          bookmarkCount={bookmarkCount}
          onExportAll={() => void exportAll()}
          onImport={() => setImportOpen(true)}
        />
      </div>
      <ImportDialog
        open={importOpen}
        folders={folders}
        initialTargetId={null}
        targetLocked={false}
        onOpenChange={setImportOpen}
        onImport={importData}
      />
    </div>
  )
}
