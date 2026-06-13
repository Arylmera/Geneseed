import React from 'react'
import { relTime } from '../../lib/format.js'

// The recent-activity / run-log list. Shows the eight most recent jobs, newest
// first, with a status dot and a relative timestamp.
export default function ActivityFeed({ jobs }) {
  if (!jobs || jobs.length === 0) {
    return (
      <div className="feed">
        <div className="empty">
          <div className="big">No activity yet</div>
          Actions you run appear here.
        </div>
      </div>
    )
  }
  const kindMap = { done: 'ok', running: 'acc', failed: 'bad' }
  const shown = [...jobs].sort((a, b) => b.started - a.started).slice(0, 8)
  return (
    <div className="feed">
      {shown.map((j) => (
        <div className="feed-row" key={j.id}>
          <span className={`feed-dot ${kindMap[j.status] || 'ok'}`} />
          <span className="feed-txt"><b>{j.action}</b></span>
          <span className="feed-when">{relTime(j.started)} ago</span>
        </div>
      ))}
    </div>
  )
}
