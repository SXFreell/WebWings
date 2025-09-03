import React from 'react'
import styles from './index.module.less'
import { Input, Button, Space, Dropdown, Menu } from '@arco-design/web-react'
import {
  IconStar,
  IconStarFill,
  IconSortAscending,
  IconSortDescending,
  IconAlignLeft,
  IconTags,
  IconMindMapping,
  IconList,
} from '@arco-design/web-react/icon'
import { useState } from 'react'
import { useAtom } from 'jotai'

import { favoriteConfigAtom } from '@/store'
import type { FavoriteConfig } from '@/store/structure'

/**
 * 计算头部高度的百分比
 * @param minHeight 最小高度
 * @param maxHeight 最大高度
 * @param scrollTop 当前滚动高度
 * @returns 头部高度的百分比
 */
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

type DropListItem<T> = { label: string, key: T, icon: React.ReactNode }

// 排序下拉菜单
const sortDropList: DropListItem<FavoriteConfig['sort']>[] = [
  { label: '默认排序', key: 'custom', icon: <IconAlignLeft /> },
  { label: '按时间顺序', key: 'timeAsc', icon: <IconSortAscending /> },
  { label: '按时间倒序', key: 'timeDesc', icon: <IconSortDescending /> },
  { label: '按标题顺序', key: 'nameAsc', icon: <IconSortAscending /> },
  { label: '按标题倒序', key: 'nameDesc', icon: <IconSortDescending /> },
]

// 视图切换下拉菜单
const viewDropList: DropListItem<FavoriteConfig['view']>[] = [
  { label: '列表视图', key: 'list', icon: <IconList /> },
  { label: '图标视图', key: 'icon', icon: <IconTags /> },
  { label: '树视图', key: 'tree', icon: <IconMindMapping /> },
]

const getItemByKey = <T extends string>(key: T, list: DropListItem<T>[]) => {
  const item = list.find(item => item.key === key)
  return item ? item : list[0]
}

/**
 * 生成下拉菜单
 * @param list 菜单项列表
 * @returns 下拉菜单组件
 */
const getDropMenu = <T extends string>(list: DropListItem<T>[], onClick: (key: T) => void, currentValue: T) => {
  return (
    <Menu>
      {list.map(item => (
        <Menu.Item key={item.key} onClick={() => onClick(item.key)} className={item.key === currentValue ? styles.dropMenuItemActive : ''}>
          {item.icon} {item.label}
        </Menu.Item>
      ))}
    </Menu>
  )
}

const Header = (
  props: { scrollTop: number, minTop: number, maxTop: number, showBorder: boolean } = { scrollTop: 0, minTop: 0, maxTop: 0, showBorder: true },
) => {
  // 收藏夹配置
  const [favoriteConfig, setFavoriteConfig] = useAtom(favoriteConfigAtom)
  const { sort, view } = favoriteConfig
  const changeSort = (newSort: FavoriteConfig['sort']) => {
    setFavoriteConfig({ ...favoriteConfig, sort: newSort })
  }
  const changeView = (newView: FavoriteConfig['view']) => {
    setFavoriteConfig({ ...favoriteConfig, view: newView })
  }

  // 将高度转换为百分比
  const { scrollTop, minTop, maxTop } = props
  const headerScrollStatus = getPercentHeight(
    minTop,
    maxTop,
    scrollTop,
  )
  const height = minTop + (maxTop - minTop) * headerScrollStatus
  const titleTextSize = 16 + (24 - 16) * headerScrollStatus

  // 收藏夹星标状态
  const [active, setActive] = useState(false)

  return (
    <div className={`${styles.homeHeader} ${props.showBorder ? styles.homeHeaderBorder : ''}`} style={{ height: `${height}px` }}>
      <div className={styles.titleText}
        style={{
          fontSize: `${titleTextSize}px`,
          top: `${8 * headerScrollStatus}px`,
        }}
      >收藏夹</div>
      <div className={styles.searchBar}
        style={{
          top: `${minTop * headerScrollStatus}px`,
          left: `${16 + 64 * (1 - headerScrollStatus)}px`,
        }}
      >
        <Input.Search allowClear placeholder='搜索' size='small' style={{ width: 160 + 80 * headerScrollStatus }} />
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
          top: `${minTop * headerScrollStatus}px`,
          right: `${16 + 40 * (1 - headerScrollStatus)}px`,
        }}
      >
        <Space>
          <Dropdown droplist={getDropMenu(sortDropList, changeSort, sort)} position='bl'>
            <Button type='secondary' size='small'>
              {getItemByKey(sort, sortDropList).icon}
              {getItemByKey(sort, sortDropList).label}
            </Button>
          </Dropdown>
          <Dropdown droplist={getDropMenu(viewDropList, changeView, view)} position='bl'>
            <Button type='secondary' size='small'>
              {getItemByKey(view, viewDropList).icon}
              {getItemByKey(view, viewDropList).label}
            </Button>
          </Dropdown>
        </Space>
      </div>
    </div>
  )
}

export default Header
