import { describe, expect, it } from 'vitest';

import en from '../../messages/en.json';
import tr from '../../messages/tr.json';

type Leaf = string | string[];

/** Flattens a message tree into "a.b.c" -> leaf. */
function flatten(tree: unknown, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  if (typeof tree === 'string' || Array.isArray(tree)) {
    out.set(prefix, tree as Leaf);
    return out;
  }
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    for (const [path, leaf] of flatten(value, prefix ? `${prefix}.${key}` : key)) {
      out.set(path, leaf);
    }
  }
  return out;
}

/** ICU argument names used by a message ("{name}", "{count, plural, ...}"). */
function argumentsOf(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

const english = flatten(en);
const turkish = flatten(tr);

describe('messages', () => {
  it('has the same keys in every locale', () => {
    const missingInTr = [...english.keys()].filter((key) => !turkish.has(key));
    const missingInEn = [...turkish.keys()].filter((key) => !english.has(key));
    expect(missingInTr).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it('uses the same shape and ICU arguments in every locale', () => {
    const mismatches: string[] = [];
    for (const [key, enLeaf] of english) {
      const trLeaf = turkish.get(key);
      if (trLeaf === undefined) continue;
      if (Array.isArray(enLeaf) !== Array.isArray(trLeaf)) {
        mismatches.push(`${key}: string vs list`);
        continue;
      }
      if (Array.isArray(enLeaf) && Array.isArray(trLeaf)) {
        if (enLeaf.length !== trLeaf.length) mismatches.push(`${key}: list length`);
        continue;
      }
      const enArgs = argumentsOf(enLeaf as string).join(',');
      const trArgs = argumentsOf(trLeaf as string).join(',');
      if (enArgs !== trArgs) mismatches.push(`${key}: {${enArgs}} vs {${trArgs}}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('has no empty messages', () => {
    const empty = [...english, ...turkish]
      .filter(([, leaf]) =>
        Array.isArray(leaf) ? leaf.some((entry) => !entry.trim()) : !leaf.trim(),
      )
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });
});
