import { expect, it } from 'vitest'
import { analysisDate, babyStatus, distribution, predictions, score } from './babyStatus'
it('uses the final need rather than the emotional label for care guidance', () => {
  expect(babyStatus({ emotion: '배고픔', need: 'stable' }).label).toBe('안정')
  expect(babyStatus({ emotion: '졸림' }).key).toBe('sleep')
  expect(babyStatus({ emotion: '알 수 없음' }).label).toBe('알 수 없음')
})
it('counts normalized analysis records instead of summing model confidence', () => {
  expect(distribution([{ emotion: '배고픔' }, { need: 'feeding' }, { need: 'stable' }]).map(r => [r.key, r.count])).toEqual([['feeding', 2], ['stable', 1]])
  expect(predictions({ emotion: '안정', topPredictions: [], top_predictions: [{ emotion: '졸림' }] })[0].emotion).toBe('졸림')
  expect(score(null)).toBeNull(); expect(score('bad')).toBeNull(); expect(score(0)).toBe(0)
})
it('parses legacy timestamps as KST independently of the device timezone', () => {
  expect(analysisDate('2026-11-16T10:00:00').toISOString()).toBe('2026-11-16T01:00:00.000Z')
  expect(analysisDate('bad')).toBeNull()
})
