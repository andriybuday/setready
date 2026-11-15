import { normalizeName } from "./normalize";
import type { RecentSetlist, SetlistSong } from "./setlistfm";

export interface PredictedSong extends SetlistSong {
  /** 0..1 share of sampled shows that included this song. */
  probability: number;
  plays: number;
  shows: number;
  avgPosition: number;
  openRate: number;
  closeRate: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/**
 * Predict tonight's setlist from the last N shows: take the median
 * set length, keep the most-played songs, order them by their average
 * position. Rotation songs surface with honest probabilities instead
 * of being hidden by copying a single show.
 */
export function predictSetlist(setlists: RecentSetlist[]): PredictedSong[] {
  if (setlists.length === 0) return [];
  const shows = setlists.length;
  const target = median(setlists.map((s) => s.songs.length));

  interface Agg {
    song: SetlistSong;
    plays: number;
    positions: number[];
    opens: number;
    closes: number;
  }
  const byKey = new Map<string, Agg>();
  for (const show of setlists) {
    const seen = new Set<string>();
    show.songs.forEach((song, i) => {
      const key = normalizeName(song.title);
      if (seen.has(key)) return;
      seen.add(key);
      const agg = byKey.get(key) ?? { song, plays: 0, positions: [], opens: 0, closes: 0 };
      agg.plays += 1;
      agg.positions.push(i + 1);
      if (i === 0) agg.opens += 1;
      if (i === show.songs.length - 1) agg.closes += 1;
      byKey.set(key, agg);
    });
  }

  const scored: PredictedSong[] = [...byKey.values()].map((a) => ({
    ...a.song,
    probability: a.plays / shows,
    plays: a.plays,
    shows,
    avgPosition: a.positions.reduce((x, y) => x + y, 0) / a.positions.length,
    openRate: a.opens / shows,
    closeRate: a.closes / shows,
  }));

  const chosen = scored
    .sort((a, b) => b.probability - a.probability || a.avgPosition - b.avgPosition)
    .slice(0, Math.max(target, 0));
  return chosen.sort((a, b) => a.avgPosition - b.avgPosition || b.probability - a.probability);
}
