import { useEffect, useRef, useState } from 'react';
import type { Student } from '@shared/types/models';
import { tr } from '../i18n';

// Excel quotes cells containing line breaks, tabs or quotation marks.
export function parseClipboardRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"' && (quoted || cell === '')) {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === '\t' || char === '\n')) {
      row.push(cell); cell = '';
      if (char === '\n') { rows.push(row); row = []; }
    } else cell += char;
  }
  if (cell || row.length || !rows.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function TutorObservationGrid({ reportId, students, values, readOnly, onValueChange, requestClear }: {
  reportId: number; students: Student[]; values: Record<string, string>; readOnly: boolean;
  onValueChange: (updates: Record<string, string>) => void; requestClear: (clear: () => Promise<void>) => void;
}) {
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const cursor = useRef(0);
  const gesture = useRef<{ start: number; origin: number; dragged: boolean; editor: HTMLTextAreaElement | null; capture: HTMLElement; pointerId: number } | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const top = selection ? Math.min(selection.start, selection.end) : null;
  const bottom = selection ? Math.max(selection.start, selection.end) : null;
  const valueAt = (row: number) => values[`${reportId}:${students[row]?.id}`] ?? '';
  const apply = async (updates: Array<{ row: number; value: string }>) => {
    if (readOnly) return;
    const changes: Record<string, string> = {};
    const valid = updates.filter(update => students[update.row]).map(update => ({ ...update, value: update.value.slice(0, 5000) }));
    valid.forEach(update => { changes[`${reportId}:${students[update.row].id}`] = update.value; });
    onValueChange(changes);
    await Promise.all(valid.map(update => window.fullSeguiment.saveTutorObservation(reportId, students[update.row].id, update.value)));
  };
  const focusGrid = () => table.current?.focus();
  const pointerDown = (event: React.PointerEvent<HTMLElement>, row: number) => {
    if (event.button !== 0) return;
    const start = event.shiftKey ? selection?.start ?? cursor.current : row;
    gesture.current = { start, origin: row, dragged: event.shiftKey, editor: event.target instanceof HTMLTextAreaElement ? event.target : null, capture: event.currentTarget, pointerId: event.pointerId };
    cursor.current = row;
    if (event.target instanceof HTMLTextAreaElement && document.activeElement === event.target && !event.shiftKey) {
      setSelection(null);
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelection({ start, end: row });
    if (event.shiftKey) focusGrid();
  };
  const pointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-tutor-row]');
    if (!cell || !table.current?.contains(cell)) return;
    const row = Number(cell.dataset.tutorRow);
    if (row === current.origin && !current.dragged) return;
    current.dragged = true; cursor.current = row; focusGrid(); window.getSelection()?.removeAllRanges();
    setSelection({ start: current.start, end: row });
  };
  const cancelGesture = () => { gesture.current = null; };
  const pointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (current.capture.hasPointerCapture(event.pointerId)) current.capture.releasePointerCapture(event.pointerId);
    if (!current.dragged && current.editor && !readOnly) { setSelection(null); current.editor.focus(); }
  };
  const keyDown = (event: React.KeyboardEvent) => {
    const focused = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tutor-row]') : null;
    const row = selection?.end ?? (focused ? Number(focused.dataset.tutorRow) : cursor.current);
    const control = event.ctrlKey || event.metaKey;
    if (['ArrowUp', 'ArrowDown'].includes(event.key) && students.length && (control || event.shiftKey || selection)) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === 'ArrowUp' ? control ? 0 : Math.max(0, row - 1) : control ? students.length - 1 : Math.min(students.length - 1, row + 1);
      cursor.current = next; focusGrid();
      setSelection({ start: event.shiftKey ? selection?.start ?? row : next, end: next });
      table.current?.querySelector(`[data-tutor-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (control && event.key.toLowerCase() === 'a' && students.length) {
      event.preventDefault(); focusGrid(); setSelection({ start: 0, end: students.length - 1 });
    } else if (event.key === 'Escape' || event.key === 'Tab') setSelection(null);
    else if (event.key === 'Enter' && selection && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault(); table.current?.querySelector<HTMLTextAreaElement>(`[data-tutor-row="${row}"] textarea`)?.focus(); setSelection(null);
    } else if (!readOnly && selection && ['Delete', 'Backspace'].includes(event.key) && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      requestClear(() => apply(Array.from({ length: bottom! - top! + 1 }, (_, index) => ({ row: top! + index, value: '' }))));
    }
  };
  return <div ref={table} className="table-wrap tutor-observation-table-wrap" tabIndex={0} onKeyDownCapture={keyDown}
    onCopy={event => { if (top === null || bottom === null) return; event.preventDefault(); event.clipboardData.setData('text/plain', Array.from({ length: bottom - top + 1 }, (_, index) => { const value = valueAt(top + index); return /[\n\t"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value; }).join('\r\n')); }}
    onPaste={event => {
      if (readOnly) { event.preventDefault(); return; }
      const focused = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tutor-row]') : null;
      const origin = top ?? (focused ? Number(focused.dataset.tutorRow) : cursor.current);
      event.preventDefault();
      const rows = parseClipboardRows(event.clipboardData.getData('text/plain'));
      const updates = rows.length === 1 && rows[0].length === 1 && top !== null && bottom !== null ? Array.from({ length: bottom - top + 1 }, (_, index) => ({ row: top + index, value: rows[0][0] })) : rows.map((row, index) => ({ row: origin + index, value: row[0] }));
      void apply(updates);
    }}>
    <table className="data-table tutor-observation-table"><thead><tr><th className="student-column">{tr('student')}</th><th>{tr('observation')}</th></tr></thead><tbody>{students.map((student, row) => <tr key={`${reportId}:${student.id}`}><td className="student-name"><span>{row + 1}</span>{student.fullName}</td><td data-tutor-row={row} className={`spreadsheet-cell ${top !== null && bottom !== null && row >= top && row <= bottom ? 'cell-selected' : ''}`} onPointerDownCapture={event => pointerDown(event, row)} onPointerMove={pointerMove} onPointerUp={pointerUp} onLostPointerCapture={cancelGesture}>
      <TutorObservationEditor reportId={reportId} studentId={student.id} initialValue={valueAt(row)} readOnly={readOnly} label={`${student.fullName}, ${tr('tutorObservations')}`} onValueChange={value => onValueChange({ [`${reportId}:${student.id}`]: value })} />
    </td></tr>)}</tbody></table>{!students.length && <div className="table-empty">{tr('noCourseStudents')}</div>}
  </div>;
}

function TutorObservationEditor({ reportId, studentId, initialValue, label, onValueChange, readOnly }: { reportId: number; studentId: number; initialValue: string; label: string; onValueChange: (value: string) => void; readOnly: boolean }) {
  const latest = useRef(initialValue); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null; };
  const save = (value: string) => { cancel(); if (!readOnly) void window.fullSeguiment.saveTutorObservation(reportId, studentId, value); };
  useEffect(() => { latest.current = initialValue; }, [initialValue]);
  useEffect(() => () => { if (timer.current !== null) { clearTimeout(timer.current); if (!readOnly) void window.fullSeguiment.saveTutorObservation(reportId, studentId, latest.current); } }, [readOnly, reportId, studentId]);
  return <textarea className="tutor-observation-editor" rows={1} value={initialValue} readOnly={readOnly} aria-label={label} placeholder={tr('tutorObservationPlaceholder')} onPaste={cancel} onChange={event => { if (readOnly) return; const value = event.target.value.slice(0, 5000); latest.current = value; onValueChange(value); cancel(); timer.current = setTimeout(() => save(value), 350); }} onBlur={() => save(initialValue)} />;
}
