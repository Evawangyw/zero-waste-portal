// 两路召回的名次融合。BM25 分和余弦分不直接相加。

const RRF_K = 60

export function fuseRanks(lists: readonly (readonly number[])[], limit: number): { id: number; score: number }[] {
  const scores = new Map<number, number>()
  for (const list of lists) {
    list.forEach((id, index) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + index + 1))
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}
