import type {Item} from "./api";
import {bytes, esc} from "./util";

/** Each dot samples one real connection range. No inferred or animated data. */
export function segmentMatrix(item: Item | undefined): string {
  const ranges = (item?.segments || []).filter(([start, , end]) => end > start);
  if (!ranges.length) return '<div class="matrix-empty">' + (item?.format ? '媒体任务未提供分段数据' : '暂无连接分段数据') + '</div>';
  return ranges.map(([start, pos, end], index) => {
    const fraction = Math.max(0, Math.min(1, (pos - start) / (end - start)));
    const received = Math.floor(fraction * 32);
    return `<div class="thread-row" title="连接 ${index + 1}：${bytes(Math.max(0, pos - start))} / ${bytes(end - start)}"><span>${String(index + 1).padStart(2, '0')}</span>${Array.from({length:32}, (_, col) => `<i class="${col < received ? 'matrix-complete' : col === received && item?.status === 'downloading' ? 'matrix-current' : 'matrix-pending'}"></i>`).join('')}</div>`;
  }).join('');
}

export function renderMatrix(items: Item[], selected: number | null): number | null {
  const item = items.find(i => i.id === selected) || items.find(i => i.status === 'downloading');
  const host = document.getElementById('thread-matrix')!;
  const markup = segmentMatrix(item);
  if (host.innerHTML !== markup) host.innerHTML = markup;
  document.getElementById('thread-name')!.textContent = item?.filename || '无活动任务';
  document.getElementById('thread-name')!.title = item?.filename || '';
  document.getElementById('thread-progress')!.textContent = item?.size ? (Math.min(100, item.downloaded / item.size * 100)).toFixed(1) + '%' : '—';
  document.getElementById('thread-connections')!.textContent = item ? `${item.connections || 0} 个连接` : '0 个连接';
  document.getElementById('inspect-threads')!.toggleAttribute('disabled', !item);
  host.setAttribute('aria-label', item ? `${item.filename}的连接分段` : '暂无连接分段数据');
  return item?.id ?? null;
}

/** Stable file identity; escaped before entering markup. The name itself
 * carries the extension, so a separate badge would only repeat it. */
export function taskName(item: Item): string {
  return `<span class="r-name" title="${esc(item.filename)}">${esc(item.filename)}</span>`;
}
