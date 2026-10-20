/**
 * Reciprocal Rank Fusion (Cormack et al., 2009) for hybrid retrieval.
 *
 * Why fuse ranks instead of raw scores: vector search returns cosine
 * similarity (~0.3-0.9) and keyword search returns ts_rank (~0.001-0.1).
 * The two scales are unrelated and shift with the query, so adding or
 * averaging them lets one retriever drown out the other. Rank positions are
 * comparable across retrievers by construction.
 *
 * Each list contributes 1 / (k + rank) for every item it contains (rank is
 * 1-based). An item ranked well by both retrievers beats one ranked first by
 * only one. k = 60 is the paper's constant: it flattens the gap between rank
 * 1 and rank 2 so a single retriever's top pick can't dominate on its own.
 */

export const RRF_K = 60;

export interface FusedItem<T> {
  item: T;
  /** Raw RRF score: sum of 1 / (k + rank) over the lists containing the item. */
  rrf: number;
  /**
   * rrf divided by the best possible score (rank 1 in every list), so 0-1.
   * Gives hybrid results a scale that a minScore threshold can apply to.
   */
  score: number;
  /** 1-based rank in each input list, or null if the list didn't contain it. */
  ranks: (number | null)[];
}

/**
 * Fuses ranked lists (best first) into one ranking. Items are matched across
 * lists by `key`; the first list's copy of an item is the one kept. Ties
 * break by best single rank, then by first appearance, so output is stable.
 */
export function reciprocalRankFusion<T>(
  lists: T[][],
  key: (item: T) => string,
  k: number = RRF_K,
): FusedItem<T>[] {
  const fused = new Map<string, FusedItem<T> & { order: number }>();
  let order = 0;

  lists.forEach((list, listIndex) => {
    list.forEach((item, i) => {
      const id = key(item);
      let entry = fused.get(id);
      if (!entry) {
        entry = { item, rrf: 0, score: 0, ranks: lists.map(() => null), order: order++ };
        fused.set(id, entry);
      }
      // A list that repeats an id only counts its best (first) position.
      if (entry.ranks[listIndex] === null) {
        entry.ranks[listIndex] = i + 1;
        entry.rrf += 1 / (k + i + 1);
      }
    });
  });

  const best = lists.length / (k + 1);
  const bestRank = (e: FusedItem<T>) => Math.min(...e.ranks.map((r) => r ?? Infinity));

  return [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf || bestRank(a) - bestRank(b) || a.order - b.order)
    .map(({ order: _order, ...e }) => ({ ...e, score: best > 0 ? e.rrf / best : 0 }));
}
