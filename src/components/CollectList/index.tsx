import styles from './index.module.less'
import { useAtom } from 'jotai'
import { favoriteConfigAtom } from '@/store'

import Toolbar from './components/Toolbar'
import { Button, Image, Space } from '@arco-design/web-react'

/**
 * 将图片URL转为Base64
 * @param url 图片地址
 * @returns Promise<string> base64字符串
 */
const urlToBase64 = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = 'Anonymous'
    img.onload = function() {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context not available'))
        return
      }
      ctx.drawImage(img, 0, 0)
      try {
        const dataURL = canvas.toDataURL('image/png')
        resolve(dataURL)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = function(err) {
      reject(err)
    }
    img.src = url
  })
}

/**
 * 判断字符串是否为 http 或 https 的 URL
 * @param url 字符串
 * @returns boolean
 */
const isHttpUrl = (url: string): boolean => {
  return /^https?:\/\//i.test(url)
}

const CollectList = (
  props: {
    scrollTop: number,
    minTop: number,
    maxTop: number,
    hasToolbar: boolean,
  } = {
    scrollTop: 0,
    minTop: 0,
    maxTop: 0,
    hasToolbar: false,
  },
) => {
  const { scrollTop, minTop, maxTop, hasToolbar } = props

  const [favoriteConfig] = useAtom(favoriteConfigAtom)
  const { sort, view } = favoriteConfig

  console.log(sort, view)
  return (
    <div className={styles.webwingsCollectList}>
      {hasToolbar && <Toolbar scrollTop={scrollTop} minTop={minTop} maxTop={maxTop} />}
      <div className={styles.collectList}>
        {Array.from({ length: 40 }).map((_, i) => (
          <div key={i} className={styles.collectListItem}>
            <div className={styles.title}>
              <img src={`https://picsum.photos/16/16?random=${i}`} />
              <span className={styles.text}>Item {i + 1}</span>
            </div>
            <Space>
              <Button type='text' size='small'>编辑</Button>
              <Button type='text' size='small'>复制</Button>
              <Button type='text' size='small'>删除</Button>
            </Space>
          </div>
        ))}
      </div>
    </div>
  )
}

export default CollectList
