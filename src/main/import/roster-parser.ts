export type RosterParseResult = { ok: true; names: string[] } | { ok: false; error: string };

export function parseRosterFile(content: string, extension: string): RosterParseResult {
  try {
    const names = extension.toLowerCase() === '.json' ? parseJson(content) : parseCsv(content);
    const cleaned = names.map(name => name.trim()).filter(Boolean);
    if (cleaned.length === 0) return { ok: false, error: 'El archivo no contiene ningún alumno.' };
    if (cleaned.some(name => name.length > 200)) return { ok: false, error: 'Hay un nombre que supera los 200 caracteres.' };
    return { ok: true, names: cleaned };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se ha podido interpretar el archivo.' };
  }
}

function parseJson(content: string): string[] {
  let value: unknown;
  try { value = JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new Error('El archivo JSON no es válido.'); }
  const list = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.students) ? value.students : null;
  if (!list) throw new Error('El JSON debe ser un array o un objeto con una propiedad “students”.');
  return list.map((entry, index) => {
    if (typeof entry === 'string') return entry;
    if (isObject(entry)) {
      const name = entry.fullName ?? entry.name ?? entry.nombre;
      if (typeof name === 'string') return name;
    }
    throw new Error(`El alumno de la posición ${index + 1} no tiene un nombre válido.`);
  });
}

function parseCsv(content: string): string[] {
  const rows = csvRows(content.replace(/^\uFEFF/, '')).filter(row => row.some(cell => cell.trim()));
  if (rows.length === 0) return [];
  const headerNames = ['alumno', 'alumna', 'nombre', 'nom', 'name', 'fullname', 'full_name', 'nombre completo', 'nom complet'];
  const normalizedHeader = rows[0].map(cell => cell.trim().toLocaleLowerCase('es'));
  const headerIndex = normalizedHeader.findIndex(cell => headerNames.includes(cell));
  const start = headerIndex >= 0 ? 1 : 0;
  const column = headerIndex >= 0 ? headerIndex : 0;
  return rows.slice(start).map(row => row[column] ?? '').filter(cell => cell.trim());
}

function csvRows(content: string): string[][] {
  const delimiter = detectDelimiter(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += char;
  }
  if (quoted) throw new Error('El CSV contiene comillas sin cerrar.');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function detectDelimiter(content: string): ',' | ';' | '\t' {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': countOutsideQuotes(firstLine, ','), ';': countOutsideQuotes(firstLine, ';'), '\t': countOutsideQuotes(firstLine, '\t') };
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',') as ',' | ';' | '\t';
}

function countOutsideQuotes(value: string, needle: string) {
  let quoted = false; let count = 0;
  for (const char of value) { if (char === '"') quoted = !quoted; else if (char === needle && !quoted) count++; }
  return count;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
