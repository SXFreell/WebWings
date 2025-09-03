import styles from './index.module.less'
import { useAtom } from 'jotai'
import { favoriteConfigAtom } from '@/store'

import Toolbar from './components/Toolbar'

const CollectList = (
  props: { scrollTop: number, minTop: number, maxTop: number, hasToolbar: boolean } = { scrollTop: 0, minTop: 0, maxTop: 0, hasToolbar: false },
) => {
  const { scrollTop, minTop, maxTop, hasToolbar } = props

  const [favoriteConfig] = useAtom(favoriteConfigAtom)
  const { sort, view } = favoriteConfig

  console.log(sort, view)
  return (
    <div className={styles.webwingsCollectList}>
      {hasToolbar && <Toolbar scrollTop={scrollTop} minTop={minTop} maxTop={maxTop} />}
      {Array.from({ length: 40 }).map((_, i) => (
        <div key={i}>Item {i + 1}</div>
      ))}
    </div>
  )
}

export default CollectList
