import test from 'node:test'
import assert from 'node:assert/strict'
import { serializableGraph, toMermaid } from '../src/mermaid.js'

test('decision branches become SI/NO Mermaid edges', () => {
  const nodes = [
    { id: 'd-1', type: 'algo', position: { x: 0, y: 0 }, data: { kind: 'decision', label: 'Utente valido?' } },
    { id: 'ok', type: 'algo', position: { x: 1, y: 1 }, data: { kind: 'end', label: 'Fine' } },
  ]
  const edges = [
    { id: 'e', source: 'd-1', target: 'ok', sourceHandle: 'yes', targetHandle: 'in' },
  ]
  const text = toMermaid(nodes, edges)
  assert.match(text, /n_d_1\{"Utente valido\?"\}/)
  assert.match(text, /n_d_1 -->\|"SÌ"\| n_ok/)
})

test('graph serialization keeps only portable algorithm data', () => {
  const graph = serializableGraph(
    [{ id: 'a', type: 'algo', position: { x: 3, y: 4 }, data: { kind: 'action', label: 'Vai' }, selected: true }],
    [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'in', markerEnd: { type: 'arrowclosed' } }],
  )
  assert.deepEqual(graph.nodes[0], {
    id: 'a',
    type: 'algo',
    position: { x: 3, y: 4 },
    data: { kind: 'action', label: 'Vai' },
  })
  assert.equal(graph.edges[0].source, 'a')
  assert.equal(graph.edges[0].markerEnd, undefined)
})
