import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'

const names = {
  start: 'Inizio',
  action: 'Azione',
  decision: 'Decisione',
  io: 'Input / Output',
  end: 'Fine',
}

function NodeShape({ data }) {
  const kind = data.kind || 'action'
  const isStart = kind === 'start'
  const isEnd = kind === 'end'
  const isDecision = kind === 'decision'

  return (
    <div className={`algo-node algo-${kind}`}>
      {!isStart && <Handle className="touch-handle" type="target" position={Position.Top} id="in" />}
      <div className="node-kind">{names[kind]}</div>
      <div className="node-label">{data.label}</div>
      {isDecision ? (
        <>
          <Handle className="touch-handle" type="source" position={Position.Left} id="no" />
          <span className="branch-label branch-no">NO</span>
          <Handle className="touch-handle" type="source" position={Position.Right} id="yes" />
          <span className="branch-label branch-yes">SÌ</span>
        </>
      ) : !isEnd ? (
        <Handle className="touch-handle" type="source" position={Position.Bottom} id="out" />
      ) : null}
    </div>
  )
}

export default memo(NodeShape)
