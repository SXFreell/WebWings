import { createHashRouter } from 'react-router-dom'
import Layout from '../layout'
import Error from '@/module/popup/pages/error'
import Home from '@/module/popup/pages/home'
import Setting from '@/module/popup/pages/setting'

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <Error />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: 'setting',
        element: <Setting />,
      },
    ],
  },
])

export default router
