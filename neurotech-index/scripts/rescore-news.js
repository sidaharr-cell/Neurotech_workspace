/**
 * rescore-news.js — one-time pass to re-score existing feed news with the
 * improved relevance prompt (which now scores off-topic items 1), then drop
 * anything below the relevance floor. Brings the live feed in line with the
 * stricter ingestion rule without waiting for items to churn out.
 *
 *   node --env-file=.env scripts/rescore-news.js
 */
import { createClient } from '@supabase/supabase-js'
import { scoreWithClaude, mediaScore, NEWS_RELEVANCE_FLOOR } from './refresh.js'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const { data: rows, error } = await supabase
  .from('news_feed').select('id,title,summary,source,published_at,metadata')
  .eq('entry_type', 'news').limit(1000)
if (error) { console.error(error); process.exit(1) }

console.log(`Re-scoring ${rows.length} news items with the stricter prompt...`)
const items = rows.map(r => ({ _id: r.id, _meta: r.metadata, title: r.title, summary: r.summary, source: r.source, published_at: r.published_at }))
const scored = await scoreWithClaude(items)

let dropped = 0, kept = 0
for (const s of scored) {
  if ((s.relevanceScore ?? 5) < NEWS_RELEVANCE_FLOOR) {
    await supabase.from('news_feed').delete().eq('id', s._id)
    dropped++
  } else {
    const rankScore = mediaScore({ relevance_score: s.relevanceScore, published_at: s.published_at, source: s.source })
    await supabase.from('news_feed').update({
      relevance_score: s.relevanceScore,
      metadata: { ...s._meta, rankScore },
    }).eq('id', s._id)
    kept++
  }
}
console.log(`✓ Kept ${kept}, dropped ${dropped} off-topic news items.`)
