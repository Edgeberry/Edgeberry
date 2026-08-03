import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

export default function TerminalPage({ onRequestClose }: { onRequestClose?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontFamily:  'monospace',
      fontSize:    14,
      theme: {
        background: '#0d0d0d',
        foreground: '#e0e0e0',
        cursor:     '#e0e0e0',
      },
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())

    if (containerRef.current) {
      term.open(containerRef.current)
      // Defer first fit: the modal CSS transition may not have settled yet
      requestAnimationFrame(() => fitAddon.fit())
    }

    const wsProto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${wsProto}://${location.host}/ws/terminal`)

    ws.onopen = () => {
      fitAddon.fit()
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    // Prevent ws.onclose from re-firing closeModal during intentional cleanup
    let closing = false

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'data') term.write(msg.data)
        if (msg.type === 'exit') { closing = true; onRequestClose?.() }
      } catch { term.write(evt.data) }
    }

    ws.onclose = () => { if (!closing) { closing = true; onRequestClose?.() } }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'data', data }))
    })

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    })
    if (containerRef.current) observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      ws.onclose = null
      ws.onmessage = null
      ws.close()
      term.dispose()
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: '#0d0d0d', padding: '4px' }} />
    </div>
  )
}
