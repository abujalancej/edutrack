import { expect, it } from 'vitest';
import { orderAssessments } from './order';

it('keeps equal dates stable, undated assessments last, and leaves the source intact', () => {
  const columns = [{ id: 1 }, { id: 2, assessmentDate: '2026-10-20' }, { id: 3, assessmentDate: '2026-10-10' }, { id: 4, assessmentDate: '2026-10-10' }, { id: 5, assessmentDate: '' }];
  expect(orderAssessments(columns).map(column => column.id)).toEqual([3, 4, 2, 1, 5]);
  expect(columns.map(column => column.id)).toEqual([1, 2, 3, 4, 5]);
});
