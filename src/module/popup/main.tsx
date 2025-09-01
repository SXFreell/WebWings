import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import '@arco-design/web-react/dist/css/arco.css'
import router from './router'

import '@/styles/global.less'

const rootElement = document.getElementById('webwings-popup-root')
if (!rootElement) {
  throw new Error('没有找到webwings-popup-root')
}
createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
