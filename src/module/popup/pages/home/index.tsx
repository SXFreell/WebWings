import styles from './index.module.less'
import { useRef, useEffect, useState } from 'react'

import Header from './components/Header'
import CollectList from '@/components/CollectList'

const minTop = 48
const maxTop = 96
const hasToolbar = true

const Home = () => {
  // 记录滚动位置
  const contentRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  useEffect(() => {
    const handleScroll = (e: Event) => {
      const target = e.target as HTMLDivElement
      setScrollTop(target.scrollTop)
    }
    const node = contentRef.current
    if (node) {
      node.addEventListener('scroll', handleScroll)
    }
    return () => {
      if (node) {
        node.removeEventListener('scroll', handleScroll)
      }
    }
  }, [])

  return (
    <div className={styles.webwingsHome}>
      <Header scrollTop={scrollTop} minTop={minTop} maxTop={maxTop} showBorder={!hasToolbar} />
      <div className={styles.content} ref={contentRef} style={{ paddingTop: `${maxTop + (hasToolbar ? 32 : 0)}px` }}>
        <CollectList scrollTop={scrollTop} minTop={minTop} maxTop={maxTop} hasToolbar={hasToolbar} />
      </div>
    </div>
  )
}

export default Home
