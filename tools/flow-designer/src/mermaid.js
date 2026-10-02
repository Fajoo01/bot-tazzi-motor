function safeId(id) {
  return 'n_' + String(id).replace(/[^a-zA-Z0-9_]/g, '_')
}

function safeLabel(label) {
  return String(label ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
}

function nodeLine(node) {
  const id = safeId(node.id)
  const label = safeLabel(node.data?.label || node.data?.kind || 'Blocco')
  switch (node.data?.kind) {
    case 'start':
    case 'end':
      return `  ${id}(["${label}"])`
    case 'decision':
      return `  ${id}{"${label}"}`
    case 'io':
      return `  ${id}[/"${label}"/]`
    default:
      return `  ${id}["${label}"]`
  }
}

function edgeLabel(edge) {
  if (edge.label) return String(edge.label)
  if (edge.sourceHandle === 'yes') return 'SÌ'
  if (edge.sourceHandle === 'no') return 'NO'
  return ''
}
export function toMermaid(nodes, edges) {
  const lines = ['flowchart TD']
  for (const node of nodes) lines.push(nodeLine(node))
  if (nodes.length && edges.length) lines.push('')
  for (const edge of edges) {
    const from = safeId(edge.source)
    const to = safeId(edge.target)
    const label = safeLabel(edgeLabel(edge))
    lines.push(label ? `  ${from} -->|"${label}"| ${to}` : `  ${from} --> ${to}`)
  }
  return lines.join('\n') + '\n'
}

export function serializableGraph(nodes, edges) {
  return {
    version: 1,
    nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data: { kind: data.kind, label: data.label } })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, label, type }) => ({
      id, source, target, sourceHandle, targetHandle, label, type,
    })),
  }
}
