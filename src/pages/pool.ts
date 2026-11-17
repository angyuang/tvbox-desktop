// 跨站片源池：以片名为关键词聚合搜索各站点，取每个站点最佳匹配影片的可播线路。
// 模块级缓存（Promise 去重），同一部影片在详情页/播放页之间共享，避免重复聚合。
import { api } from "../api";
import type { PoolEntry, VideoCard, VideoDetail } from "../types";

const cache = new Map<string, Promise<PoolEntry[]>>();

/** 标题归一化：去空白/常见标点/大小写，作为缓存键与匹配依据 */
function normTitle(t: string): string {
  return t
    .replace(
      /[\s＆&·・：:（）()【】\[\]「」『』《》"'’‘“”,，。.、!！?？\-—_~～]/g,
      ""
    )
    .toLowerCase();
}

/** 从某站点搜索结果里挑最佳匹配：同名 > 互相包含 > 第一条 */
function pickMatch(items: VideoCard[], title: string): VideoCard | null {
  if (items.length === 0) return null;
  const nt = normTitle(title);
  const exact = items.find((c) => normTitle(c.name) === nt);
  if (exact) return exact;
  const contains = items.find((c) => {
    const cn = normTitle(c.name);
    return cn.includes(nt) || nt.includes(cn);
  });
  return contains ?? items[0];
}

function toEntry(d: VideoDetail): PoolEntry {
  return {
    site_key: d.site_key,
    site_name: d.site_name,
    vod_id: d.vod_id,
    vod_name: d.name,
    pic: d.pic,
    remarks: d.remarks,
    lines: d.sources.map((s) => ({ name: s.name, count: s.episodes.length })),
  };
}

/** 有限并发 map：保序，失败项返回 null */
async function mapLimit<T, R>(
  list: T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<(R | null)[]> {
  const out: (R | null)[] = new Array(list.length).fill(null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const idx = cursor++;
      try {
        out[idx] = await fn(list[idx]);
      } catch {
        out[idx] = null;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, () => worker())
  );
  return out;
}

async function build(title: string): Promise<PoolEntry[]> {
  const groups = await api.aggregateSearch(title);
  const matches: VideoCard[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    if (!g.ok || g.items.length === 0) continue;
    const c = pickMatch(g.items, title);
    if (!c) continue;
    const k = `${c.site_key}:${c.vod_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    matches.push(c);
  }
  // 并发 6 路拉各站详情（拿线路名/集数），失败的站点直接跳过，顺序保持站点顺序
  const entries = await mapLimit(matches, 6, async (c) =>
    toEntry(await api.getDetail(c.site_key, c.vod_id))
  );
  return entries.filter((e): e is PoolEntry => e !== null && e.lines.length > 0);
}

/** 获取某片名的跨站片源池（带缓存；失败不缓存，可重试） */
export function getSourcePool(title: string): Promise<PoolEntry[]> {
  const key = normTitle(title);
  if (!key) return Promise.resolve([]);
  const hit = cache.get(key);
  if (hit) return hit;
  const p = build(title);
  cache.set(key, p);
  p.catch(() => cache.delete(key)); // 失败允许下次重试
  return p;
}
