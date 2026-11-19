import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export function PanelPages({ children, pageSize, label, className }: {
  children: ReactNode[]
  pageSize: number
  label: string
  className?: string
}) {
  const [requestedPage, setPage] = useState(0)
  const pageCount = Math.ceil(children.length / pageSize)
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1))

  return <div className="phase-panel-pages">
    <div className={className}>{children.slice(page * pageSize, (page + 1) * pageSize)}</div>
    {pageCount > 1 ? <nav className="panel-pager" aria-label={label}>
      <button type="button" aria-label={`Previous ${label.toLowerCase()} page`} disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft/></button>
      <span aria-live="polite">{page + 1} / {pageCount}</span>
      <button type="button" aria-label={`Next ${label.toLowerCase()} page`} disabled={page === pageCount - 1} onClick={() => setPage(page + 1)}><ChevronRight/></button>
    </nav> : null}
  </div>
}
