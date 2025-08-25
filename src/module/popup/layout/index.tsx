import styles from './index.module.less'
import { Outlet } from 'react-router-dom'

const Layout = () => {
  return (
    <div className={styles.webwingsLayout}>
      <div className={styles.header}>1</div>
      <div className={styles.content}>
        <div className={styles.sideBar}>2</div>
        <div className={styles.main}>
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default Layout
