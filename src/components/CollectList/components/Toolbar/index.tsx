import styles from './index.module.less'

import { Breadcrumb, Button, Space, Typography } from '@arco-design/web-react'

const Toolbar = (
  props: { scrollTop: number, minTop: number, maxTop: number } = { scrollTop: 0, minTop: 0, maxTop: 0 },
) => {
  const { scrollTop = 0, minTop = 0, maxTop = 0 } = props
  return (
    <div className={styles.webwingsCollectListToolbar} style={{ top: scrollTop < minTop ? maxTop - scrollTop : minTop }}>
      <Breadcrumb maxCount={3}>
        <Breadcrumb.Item>首页</Breadcrumb.Item>
        {Array.from({ length: 5 }).map((_, i) => (
          <Breadcrumb.Item key={i}>
            <Typography.Ellipsis
              style={{ maxWidth: 70 }}
              showTooltip
            >收藏夹收藏</Typography.Ellipsis>
          </Breadcrumb.Item>
        ))}
      </Breadcrumb>
      <Space>
        <Button type='text' size='small'>新建文件夹</Button>
        <Button type='text' size='small'>新建收藏</Button>
      </Space>
    </div>
  )
}

export default Toolbar
