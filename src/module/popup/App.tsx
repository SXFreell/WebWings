import { openSidePanel } from '@/utils/sidePanel'

function App() {
  return (
    <div>
      <h1>Hello World</h1>
      <button onClick={() => {
        openSidePanel()
      }}>
        Open SidePanel
      </button>
    </div>
  )
}

export default App
