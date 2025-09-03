import styles from './index.module.less'
import { menuList } from '@/module/popup/router/menu'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAtom } from 'jotai'

import type { StoreStructure } from '@/module/popup/store/structure'

import {
  IconSettings,
  IconLayout,
  IconTranslate,
  IconMoon,
  IconSun,
} from '@arco-design/web-react/icon'

import {
  themeAtom,
  siderCollapsedAtom,
} from '@/module/popup/store'

import { Popover } from '@arco-design/web-react'

const Sider = () => {
  // 路由
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = location.pathname

  const handleMenuClick = (path: string) => {
    navigate(path)
  }

  // 主题
  const [theme, setTheme] = useAtom(themeAtom)
  const themeName = theme === 'auto' ? '跟随系统' : theme === 'dark' ? '暗黑模式' : '亮色模式'
  const themeIcon = theme === 'auto' ? IconTranslate : theme === 'dark' ? IconMoon : IconSun
  const changeTheme = (theme: StoreStructure['theme']) => {
    setTheme(theme)
  }

  // 收起侧边栏
  const [siderCollapsed, setSiderCollapsed] = useAtom(siderCollapsedAtom)
  const toggleCollapsed = () => {
    setSiderCollapsed(!siderCollapsed)
  }

  // 操作按钮
  const actionList = [
    {
      key: '/setting',
      name: '设置',
      action: () => {
        navigate('/setting')
      },
      icon: IconSettings,
    },
    {
      key: '/__theme',
      name: themeName,
      action: () => {
        changeTheme(theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto')
      },
      icon: themeIcon,
    },
    {
      key: '/__collapse',
      name: siderCollapsed ? '打开侧边栏' : '收起侧边栏',
      action: () => {
        toggleCollapsed()
      },
      icon: IconLayout,
    },
  ]

  return (
    <div
      className={styles.webwingsSider}
      style={{ width: siderCollapsed ? '48px' : '220px' }}
    >
      <div
        className={styles.title}
        style={{ flexBasis: siderCollapsed ? '0' : '48px' }}
      >
        <span>WebWings</span>
      </div>
      <div className={styles.menu}>
        {menuList.map((item) => (
          <div
            key={item.path}
            className={`${styles.menuItem} ${currentPath === item.path ? styles.active : ''}`}
            style={{
              width: siderCollapsed ? '32px' : '204px',
              padding: siderCollapsed ? '0 8px' : '0 12px',
            }}
            onClick={() => handleMenuClick(item.path)}
          >
            <div className={styles.icon}>
              <item.icon
                style={currentPath === item.path ? { color: 'rgb(var(--primary-6))' } : {}}
                fontSize={16}
              />
            </div>
            <span>{item.name}</span>
          </div>
        ))}
      </div>
      <div
        className={styles.action}
        style={{ flexBasis: siderCollapsed ? `${8 + actionList.length * 40}px` : '48px' }}
      >
        {actionList.map((item, index) => (
          <Popover
            key={item.key}
            className={styles.actionPopover}
            content={ item.name }
            position={ siderCollapsed ? 'right' : 'top'}
          >
            <div
              className={`${styles.actionItem} ${currentPath === item.key ? styles.active : ''}`}
              style={{
                left: siderCollapsed ? '8px' : `${8 + index * 40}px`,
                top: siderCollapsed ? `${8 + index * 40}px` : '8px',
              }}
              onClick={item.action}
            >
              <item.icon
                style={currentPath === item.key ? { color: 'rgb(var(--primary-6))' } : {}}
                fontSize={18}
              />
            </div>
          </Popover>
        ))}
      </div>
    </div>
  )
}

export default Sider
