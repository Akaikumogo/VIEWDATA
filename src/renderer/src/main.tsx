import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Navigate, RouterProvider, createHashRouter } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ChangesView } from './routes/ChangesView'
import { DbOverview } from './routes/DbOverview'
import { HealthView } from './routes/HealthView'
import { Home } from './routes/Home'
import { QueryView } from './routes/QueryView'
import { SchemaView } from './routes/SchemaView'
import { TableView } from './routes/TableView'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 30_000 }
  }
})

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      {
        path: 'db/:dbId',
        children: [
          { index: true, element: <DbOverview /> },
          { path: 'schema', element: <SchemaView /> },
          { path: 'query', element: <QueryView /> },
          { path: 'health', element: <HealthView /> },
          { path: 'changes', element: <ChangesView /> },
          { path: 'table/:entity', element: <TableView /> }
        ]
      },
      { path: '*', element: <Navigate to="/" replace /> }
    ]
  }
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
)
