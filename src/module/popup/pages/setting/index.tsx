import styles from './index.module.less'

const Layout = () => {
  return (
    <div className={styles.webwingsLayout}>
      <div className={styles.header}>1</div>
      <div className={styles.content}>
        <div className={styles.sideBar}>2</div>
        <div className={styles.main}>3</div>
      </div>
    </div>
  )
}

export default Layout
