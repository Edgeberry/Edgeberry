/*
 *  Shared presentational pieces
 *  Small components used by more than one page. Anything here should be free of
 *  device knowledge — it takes props and renders.
 */

import type { ReactNode } from 'react'

/** Small caps heading that separates sections within a page. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-uppercase fw-semibold mb-2"
      style={{ fontSize: '0.7rem', letterSpacing: '0.1em', color: 'var(--eb-primary)' }}
    >
      {children}
    </div>
  )
}

/** Label/value row for read-only detail lists. */
export function Field({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="d-flex gap-3 py-1" style={{ fontSize: '0.85rem' }}>
      <span className="text-muted" style={{ minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: mono ? 'monospace' : undefined, wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

/** Panel used for inline confirmations and expanded row detail. */
export function InsetPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 p-3" style={{ background: 'rgba(0,0,0,0.03)', borderRadius: 8 }}>
      {children}
    </div>
  )
}

/** Four-bar signal strength meter, coloured by quality. */
export function SignalBars({ strength }: { strength: number }) {
  const filled = Math.round((strength / 100) * 4)
  const color =
    strength >= 70 ? 'var(--eb-ok)' :
    strength >= 40 ? 'var(--eb-warn)' :
                     'var(--eb-fault)'
  return (
    <span style={{ color, fontFamily: 'monospace', fontSize: '0.8rem', letterSpacing: '-1px' }}>
      {'▂▄▆█'.split('').map((bar, i) => (
        <span key={i} style={{ opacity: i < filled ? 1 : 0.2 }}>{bar}</span>
      ))}
    </span>
  )
}
