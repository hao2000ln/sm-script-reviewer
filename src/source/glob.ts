export function matchesGlob(path: string, pattern: string): boolean {
  const normalizedPath = normalize(path);
  const normalizedPattern = normalize(pattern).replace(/^\.\//u, '').replace(/^\//u, '');
  if (normalizedPattern.length === 0) return false;

  if (normalizedPattern.endsWith('/**')) {
    const directory = normalizedPattern.slice(0, -3).replace(/\/$/u, '');
    if (normalizedPath === directory || normalizedPath.startsWith(`${directory}/`)) return true;
  }

  const source = globSource(normalizedPattern);
  const prefix = normalizedPattern.includes('/') ? '^' : '^(?:.*/)?';
  return new RegExp(`${prefix}${source}$`, 'u').test(normalizedPath);
}

function globSource(pattern: string): string {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += escapeRegex(character);
    }
  }
  return source;
}

function escapeRegex(character: string): string {
  return /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;
}

function normalize(value: string): string {
  return value.replaceAll('\\', '/');
}
