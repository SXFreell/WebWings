import styles from './index.module.less'
import { Outlet } from 'react-router-dom'

import Sider from './components/Sider'

const Layout = () => {
  return (
    <div className={styles.webwingsLayout}>
      <Sider />
      <div className={styles.main}>
        <Outlet />
      </div>
    </div>
  )
}

export default Layout
