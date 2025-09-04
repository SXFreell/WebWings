import styles from './index.module.less'

import { Breadcrumb, Button, Space, Typography } from '@arco-design/web-react'
import { IconFolderAdd, IconSubscribeAdd } from '@arco-design/web-react/icon'

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
              style={{ maxWidth: 98 }}
              showTooltip
            >收藏夹收藏收藏1</Typography.Ellipsis>
          </Breadcrumb.Item>
        ))}
      </Breadcrumb>
      <Space>
        <Button size='small' icon={<IconFolderAdd />}>
          文件夹
        </Button>
        <Button size='small' icon={<IconSubscribeAdd />}>
          收藏
        </Button>
      </Space>
    </div>
  )
}

export default Toolbar
