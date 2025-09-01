import { Button } from '@arco-design/web-react'
import styles from './index.module.less'

const changeColor = () => {
  const currentTheme = document.body.getAttribute('arco-theme')
  if (currentTheme === 'dark') {
    document.body.setAttribute('arco-theme', 'light')
    return
  }
  document.body.setAttribute('arco-theme', 'dark')
}

const Home = () => {
  return (
    <div className={styles.webwingsHome}>
      Home
      <Button onClick={changeColor}>切换颜色</Button>
    </div>
  )
}

export default Home
