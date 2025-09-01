import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import router from './router'
import '@arco-design/web-react/dist/css/arco.css'
import '@/styles/global.less'

import { listenSystemTheme } from '@/utils/theme'


const theme = localStorage.getItem('__theme') || 'light'
document.body.setAttribute('arco-theme', theme)
listenSystemTheme()

const rootElement = document.getElementById('webwings-popup-root')
if (!rootElement) {
  throw new Error('没有找到webwings-popup-root')
}
createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
