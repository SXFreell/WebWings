import styles from './index.module.less'
import { Input, Button } from '@arco-design/web-react'
import { IconStar, IconStarFill } from '@arco-design/web-react/icon'
import { useState } from 'react'

const getPercentHeight = (
  minHeight: number,
  maxHeight: number,
  scrollTop: number,
) => {
  return Math.max(
    0,
    Math.min(1, 1 - scrollTop / (maxHeight - minHeight)),
  )
}

const Header = (
  props: { scrollTop?: number },
) => {
  const { scrollTop } = props

  // 将高度转换为百分比
  const minHeight = 48
  const maxHeight = 96
  const headerScrollStatus = getPercentHeight(
    minHeight,
    maxHeight,
    scrollTop || 0,
  )
  const height = minHeight + (maxHeight - minHeight) * headerScrollStatus
  const titleTextSize = 16 + (24 - 16) * headerScrollStatus

  const [active, setActive] = useState(false)

  return (
    <div className={styles.homeHeader} style={{ height: `${height}px` }}>
      <div className={styles.titleText}
        style={{
          fontSize: `${titleTextSize}px`,
          top: `${8 * headerScrollStatus}px`,
        }}
      >收藏夹</div>
      <div className={styles.searchBar}
        style={{
          top: `${minHeight * headerScrollStatus}px`,
          left: `${16 + 64 * (1 - headerScrollStatus)}px`,
        }}
      >
        <Input.Search allowClear placeholder='搜索' size='small' style={{ width: 160 + 40 * headerScrollStatus }} />
      </div>
      <div className={styles.starBtn}
        style={{
          top: `${8 * headerScrollStatus}px`,
        }}
      >
        <div className={styles.iconBtn} onClick={() => {
          setActive(!active)
        }}>
          <IconStar className={styles.icon} fontSize={18} style={{ opacity: active ? 1 : 0, color: 'var(--color-text-3)' }} />
          <IconStarFill className={styles.icon} fontSize={18} style={{ opacity: active ? 0 : 1, color: 'rgb(var(--primary-6))' }} />
        </div>
      </div>
      <div className={styles.settingBtns}
        style={{
          top: `${minHeight * headerScrollStatus}px`,
          right: `${16 + 40 * (1 - headerScrollStatus)}px`,
        }}
      >
        <Button type="text">设置</Button>
      </div>
    </div>
  )
}

export default Header
