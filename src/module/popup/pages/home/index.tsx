import styles from './index.module.less'
import Header from './components/Header'
import { useRef, useEffect, useState } from 'react'

const Home = () => {
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
      <Header scrollTop={scrollTop} />
      <div className={styles.content} ref={contentRef}>
        {Array.from({ length: 40 }, (_, index) => (
          <div key={index} className={styles.card}>
            Card {index + 1}
          </div>
        ))}
      </div>
    </div>
  )
}

export default Home
