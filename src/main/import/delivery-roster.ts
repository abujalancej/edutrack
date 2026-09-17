import type { FullSeguimentExport } from '../../shared/types/models';
import { compareStudentNames } from './validation';

export const DELIVERY_ROSTER_MESSAGE = 'El listado de la entrega no coincide con el informe. Actualiza el listado y reexporta la entrega.';

export function compareDeliveryRoster(data: FullSeguimentExport, roster: string[], historicalNames: string[]) {
  const active = data.students.filter(student => data.version === 1 || student.enrolled !== false || roster.includes(student.name)).map(student => student.name);
  const difference = compareStudentNames(roster, active);
  const names = data.students.map(student => student.name);
  const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
  const historical = data.version === 2
    ? data.students.filter(student => student.enrolled === false && !roster.includes(student.name)).map(student => student.name)
    : [];
  const unknownHistorical = historical.filter(name => historicalNames.filter(candidate => candidate === name).length !== 1 || roster.includes(name));
  return {
    ...difference,
    matches: difference.matches && duplicated.length === 0 && unknownHistorical.length === 0,
    extraInFile: [...difference.extraInFile, ...historical, ...unknownHistorical, ...duplicated].filter((name, index, all) => all.indexOf(name) === index)
  };
}

export function deliveryRosterError(comparison: ReturnType<typeof compareDeliveryRoster>) {
  const additions = comparison.missingInFile.join(', ') || 'ninguna';
  const removals = comparison.extraInFile.join(', ') || 'ninguna';
  return `${DELIVERY_ROSTER_MESSAGE} Altas en el centro: ${additions}. Bajas o alumnos sin correspondencia: ${removals}.`;
}
