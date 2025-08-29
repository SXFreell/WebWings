import styles from './index.module.less'
import { menuList } from '@/module/popup/router/menu'
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IconSettings } from '@arco-design/web-react/icon'

const Sider = () => {
  // 路由
  const location = useLocation()
  const navigate = useNavigate()
  const currentPath = location.pathname

  const handleMenuClick = (path: string) => {
    navigate(path)
  }

  // 主题
  const theme = localStorage.getItem('theme') || 'light'
  // const changeTheme = (theme: string) => {
  //   localStorage.setItem('theme', theme)
  //   document.body.setAttribute('arco-theme', theme)
  // }

  // 收起侧边栏
  const [collapsed, setCollapsed] = useState(false)
  const toggleCollapsed = () => {
    setCollapsed(!collapsed)
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
      name: theme === 'dark' ? '亮色模式' : '暗黑模式',
      action: () => {},
      icon: IconSettings,
    },
    {
      key: '/__collapse',
      name: collapsed ? '打开侧边栏' : '收起侧边栏',
      action: () => {
        toggleCollapsed()
      },
      icon: IconSettings,
    },
  ]

  return (
    <div
      className={styles.webwingsSider}
      style={{ width: collapsed ? '48px' : '220px' }}
    >
      <div
        className={styles.title}
        style={{ flexBasis: collapsed ? '0' : '48px' }}
      >
        <span>WebWings</span>
      </div>
      <div className={styles.menu}>
        {menuList.map((item) => (
          <div
            key={item.path}
            className={`${styles.menuItem} ${currentPath === item.path ? styles.active : ''}`}
            style={{
              width: collapsed ? '32px' : '204px',
              padding: collapsed ? '0 8px' : '0 12px',
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
        style={{ flexBasis: collapsed ? `${8 + actionList.length * 40}px` : '48px' }}
      >
        {actionList.map((item, index) => (
          <div
            key={item.key}
            className={`${styles.actionItem} ${currentPath === item.key ? styles.active : ''}`}
            style={{
              left: collapsed ? '8px' : `${8 + index * 40}px`,
              top: collapsed ? `${8 + index * 40}px` : '8px',
            }}
            onClick={item.action}
          >
            <item.icon
              style={currentPath === item.key ? { color: 'rgb(var(--primary-6))' } : {}}
              fontSize={18}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default Sider
