const CONNECTORS = new Set(['a', 'al', 'and', 'da', 'de', 'del', 'do', 'e', 'el', 'eta', 'i', 'la', 'les', 'of', 'the', 'y']);

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim();

const tokensFor = (subject: string) => {
  const tokens = normalize(subject).split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter(token => !CONNECTORS.has(token.toLocaleLowerCase()));
  return meaningful.length ? meaningful : tokens;
};

const twoLetters = (value: string) => (value + value.slice(0, 1) + 'X').slice(0, 2);

const naturalMonogram = (tokens: string[]) => twoLetters(tokens.length > 1 ? `${tokens[0][0]}${tokens[1][0]}` : tokens[0] ?? 'XX');

const commonPrefixLength = (values: string[]) => {
  const shortest = Math.min(...values.map(value => value.length));
  let index = 0;
  while (index < shortest && values.every(value => value[index] === values[0][index])) index += 1;
  return index;
};

export function subjectMonograms(subjects: string[]) {
  const uniqueSubjects = [...new Set(subjects)];
  const tokens = new Map(uniqueSubjects.map(subject => [subject, tokensFor(subject)]));
  const result = new Map(uniqueSubjects.map(subject => [subject, naturalMonogram(tokens.get(subject) ?? [])]));
  const collisions = new Map<string, string[]>();
  for (const subject of uniqueSubjects) {
    const monogram = result.get(subject)!;
    collisions.set(monogram, [...(collisions.get(monogram) ?? []), subject]);
  }

  for (const group of collisions.values()) {
    if (group.length < 2) continue;
    const tokenLists = group.map(subject => tokens.get(subject) ?? []);
    const maxTokens = Math.max(...tokenLists.map(list => list.length));
    const differingIndex = Array.from({ length: maxTokens }, (_, index) => index)
      .find(index => new Set(tokenLists.map(list => list[index] ?? '')).size > 1) ?? 0;
    const variants = tokenLists.map(list => list[differingIndex] ?? list.join(''));
    const prefixLength = commonPrefixLength(variants);
    const used = new Set<string>();

    group.forEach((subject, index) => {
      const variant = variants[index] || normalize(subject).replaceAll(' ', '');
      const anchor = variant[0] ?? 'X';
      const candidates = [
        ...variant.slice(prefixLength),
        ...variant.slice(1),
        ...normalize(subject).replaceAll(' ', ''),
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
      ].map(letter => twoLetters(`${anchor}${letter}`));
      const monogram = candidates.find(candidate => !used.has(candidate)) ?? twoLetters(anchor);
      used.add(monogram);
      result.set(subject, monogram);
    });
  }

  return result;
}
