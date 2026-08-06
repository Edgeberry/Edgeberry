import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

/**
 * Resolve a theme token to a literal colour.
 *
 * xterm renders to a canvas and cannot resolve `var()`, so the tokens have to
 * be read off the document. The fallback covers the theme stylesheet failing to
 * load — better a readable terminal than an invisible one.
 */
function themeColor( token:string, fallback:string ):string{
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return value || fallback
}

export default function TerminalPage({ onRequestClose }: { onRequestClose?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const background = themeColor('--eb-navbar-bg', '#1e1e1e')
    const foreground = themeColor('--eb-navbar-fg', '#f5f5f5')

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:  'monospace',
      fontSize:    14,
      theme: { background, foreground, cursor: foreground },
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
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--eb-navbar-bg)', padding: '4px' }} />
    </div>
  )
}
