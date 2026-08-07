import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, Search } from 'lucide-react'
import type { ActivityApplication } from '../../app/runtime'
import type { ActivityPage as ActivityResult } from '../../application/activityService'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'

export function ActivityPage({ service }: { service: ActivityApplication }) {
  const [search, setSearch] = useState('')
  const [pageNumber, setPageNumber] = useState(1)
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25)
  const [result, setResult] = useState<ActivityResult | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const requestRef = useRef(0)
  const load = useCallback(async () => {
    const request = ++requestRef.current
    setState((current) => current === 'ready' ? current : 'loading')
    try {
      const next = await service.list({ search, page: pageNumber, pageSize })
      if (request === requestRef.current) {
        setResult(next)
        setState('ready')
      }
    } catch {
      if (request === requestRef.current) setState('error')
    }
  }, [pageNumber, pageSize, search, service])
  useEffect(() => { void load() }, [load])

  return (
    <div className="activity-page">
      <section className="page-hero">
        <div><p className="eyebrow">A transparent record</p><h1 id="page-title">Activity</h1><p className="page-hero__description">A privacy-safe timeline of important changes to this workspace.</p></div>
      </section>
      <Card className="activity-toolbar">
        <label className="filter-search"><span className="sr-only">Search activity</span><Search size={18} aria-hidden="true" /><input value={search} placeholder="Search activity" onChange={(event) => { setSearch(event.target.value); setPageNumber(1) }} /></label>
      </Card>
      {state === 'loading' ? <div className="workspace-state" role="status"><span className="workspace-state__spinner" /><p>Loading activity</p></div> : null}
      {state === 'error' ? <div className="workspace-state" role="alert"><h2>Activity could not be refreshed</h2><p>Your records were not changed.</p><Button onClick={() => void load()}>Try again</Button></div> : null}
      {result?.total === 0 ? <Card className="transactions-empty"><EmptyState icon={<Activity aria-hidden="true" />} title={search ? 'No matching activity' : 'No activity yet'} description={search ? 'Try a different search.' : 'Important changes will appear here without exposing record identifiers or file paths.'} /></Card> : null}
      {result && result.total > 0 ? (
        <>
          <ol className="activity-timeline">
            {result.items.map((item) => (
              <li key={item.id}><span className="activity-timeline__marker" aria-hidden="true" /><Card><strong>{item.message}</strong><time dateTime={item.timestamp}>{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.timestamp))}</time></Card></li>
            ))}
          </ol>
          <nav className="pagination" aria-label="Activity pages">
            <Button variant="ghost" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => value - 1)}>Previous</Button>
            <span>Page {result.page} of {Math.max(1, result.pageCount)}</span>
            <select aria-label="Activity rows per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value) as 25 | 50 | 100); setPageNumber(1) }}><option>25</option><option>50</option><option>100</option></select>
            <Button variant="ghost" disabled={pageNumber >= result.pageCount} onClick={() => setPageNumber((value) => value + 1)}>Next</Button>
          </nav>
        </>
      ) : null}
    </div>
  )
}
