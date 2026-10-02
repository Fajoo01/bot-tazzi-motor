import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge, Background, Controls, MarkerType, MiniMap,
  ReactFlow, ReactFlowProvider, useEdgesState, useNodesState,
} from '@xyflow/react'
import NodeShape from './NodeShape.jsx'
import { serializableGraph, toMermaid } from './mermaid.js'

const STORAGE_KEY = 'bottazzi-flow-v1'
const nodeTypes = { algo: NodeShape }
const kindDefaults = {
  start: 'Inizio',
  action: 'Nuova azione',
  decision: 'Condizione?',
  io: 'Dato in ingresso / uscita',
  end: 'Fine',
}

const sampleNodes = [
  { id: 'start', type: 'algo', position: { x: 80, y: 40 }, data: { kind: 'start', label: 'Inizio' } },
  { id: 'action', type: 'algo', position: { x: 70, y: 190 }, data: { kind: 'action', label: 'Esegui operazione' } },
  { id: 'decision', type: 'algo', position: { x: 65, y: 350 }, data: { kind: 'decision', label: 'Va bene?' } },
  { id: 'end', type: 'algo', position: { x: 360, y: 500 }, data: { kind: 'end', label: 'Fine' } },
]
const sampleEdges = [
  { id: 'e1', source: 'start', target: 'action', sourceHandle: 'out', targetHandle: 'in', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e2', source: 'action', target: 'decision', sourceHandle: 'out', targetHandle: 'in', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e3', source: 'decision', target: 'end', sourceHandle: 'yes', targetHandle: 'in', label: 'SÌ', markerEnd: { type: MarkerType.ArrowClosed } },
]

function normalizeEdges(edges) {
  return edges.map((edge) => ({ ...edge, markerEnd: { type: MarkerType.ArrowClosed } }))
}

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { nodes: sampleNodes, edges: sampleEdges }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('Formato non valido')
    return { nodes: parsed.nodes, edges: normalizeEdges(parsed.edges) }
  } catch {
    return { nodes: sampleNodes, edges: sampleEdges }
  }
}

function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
function FlowDesigner() {
  const initial = useMemo(loadInitial, [])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)
  const [selectedId, setSelectedId] = useState(null)
  const [rf, setRf] = useState(null)
  const fileInput = useRef(null)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableGraph(nodes, edges)))
    } catch {}
  }, [nodes, edges])

  const onConnect = useCallback((connection) => {
    const label = connection.sourceHandle === 'yes' ? 'SÌ' : connection.sourceHandle === 'no' ? 'NO' : undefined
    setEdges((current) => addEdge({
      ...connection,
      label,
      markerEnd: { type: MarkerType.ArrowClosed },
    }, current))
  }, [setEdges])

  const addNode = useCallback((kind) => {
    const fallback = { x: 120 + nodes.length * 18, y: 140 + nodes.length * 18 }
    const position = rf?.screenToFlowPosition
      ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      : fallback
    const id = `${kind}-${Date.now().toString(36)}`
    setNodes((current) => current.concat({
      id,
      type: 'algo',
      position,
      data: { kind, label: kindDefaults[kind] },
    }))
    setSelectedId(id)
  }, [nodes.length, rf, setNodes])

  const selectedNode = nodes.find((node) => node.id === selectedId)

  const renameSelected = useCallback((label) => {
    setNodes((current) => current.map((node) =>
      node.id === selectedId ? { ...node, data: { ...node.data, label } } : node
    ))
  }, [selectedId, setNodes])

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setNodes((current) => current.filter((node) => node.id !== selectedId))
    setEdges((current) => current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId))
    setSelectedId(null)
  }, [selectedId, setEdges, setNodes])

  const clearGraph = useCallback(() => {
    if (!window.confirm('Cancellare tutto il diagramma?')) return
    setNodes([])
    setEdges([])
    setSelectedId(null)
  }, [setEdges, setNodes])
  const exportJson = useCallback(() => {
    download('algoritmo.bottazzi-flow.json', JSON.stringify(serializableGraph(nodes, edges), null, 2), 'application/json')
  }, [nodes, edges])

  const exportMermaid = useCallback(() => {
    download('algoritmo.mmd', toMermaid(nodes, edges), 'text/plain')
  }, [nodes, edges])

  const copyMermaid = useCallback(async () => {
    const text = toMermaid(nodes, edges)
    try {
      await navigator.clipboard.writeText(text)
      window.alert('Mermaid copiato negli appunti.')
    } catch {
      download('algoritmo.mmd', text, 'text/plain')
    }
  }, [nodes, edges])

  const importJson = useCallback(async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('Formato non valido')
      setNodes(parsed.nodes.map((node) => ({ ...node, type: 'algo' })))
      setEdges(normalizeEdges(parsed.edges))
      setSelectedId(null)
      setTimeout(() => rf?.fitView({ padding: 0.2 }), 0)
    } catch (error) {
      window.alert(`Import non riuscito: ${error.message}`)
    }
  }, [rf, setEdges, setNodes])
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>Bot-tazzi Flow</strong>
          <span>algoritmi visuali</span>
        </div>
        <div className="toolbar" aria-label="Blocchi algoritmo">
          <button onClick={() => addNode('start')}>+ Inizio</button>
          <button onClick={() => addNode('action')}>+ Azione</button>
          <button onClick={() => addNode('decision')}>+ Decisione</button>
          <button onClick={() => addNode('io')}>+ I/O</button>
          <button onClick={() => addNode('end')}>+ Fine</button>
        </div>
        <div className="toolbar secondary" aria-label="Azioni diagramma">
          <button onClick={() => rf?.fitView({ padding: 0.2 })}>Adatta</button>
          <button onClick={exportJson}>JSON</button>
          <button onClick={() => fileInput.current?.click()}>Importa</button>
          <button onClick={copyMermaid}>Copia Mermaid</button>
          <button onClick={exportMermaid}>.mmd</button>
          <button className="danger" onClick={clearGraph}>Svuota</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importJson} />
        </div>
        {selectedNode && (
          <div className="node-editor">
            <label htmlFor="node-label">Testo blocco</label>
            <input id="node-label" value={selectedNode.data.label} onChange={(e) => renameSelected(e.target.value)} />
            <button className="danger" onClick={deleteSelected}>Elimina</button>
          </div>
        )}
      </header>
      <section className="canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setRf}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          connectOnClick
          connectionRadius={28}
          minZoom={0.2}
          maxZoom={2.5}
          panOnScroll
          selectionOnDrag={false}
          fitView
        >
          <MiniMap pannable zoomable />
          <Controls showInteractive={false} />
          <Background gap={18} size={1} />
        </ReactFlow>
      </section>
      <footer className="hint">
        Tocca un blocco per rinominarlo. Per collegare da telefono: tocca un pallino d'uscita e poi un pallino d'ingresso.
      </footer>
    </main>
  )
}

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowDesigner />
    </ReactFlowProvider>
  )
}
