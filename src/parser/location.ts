import ts from 'typescript';
import type { SourceLocation } from '../core/types';

export type LocationMapper = (offset: number) => SourceLocation;

/**
 * TypeScript and JavaScript string offsets are UTF-16 code-unit offsets.
 * Lines and columns are exposed as 1-based values for CLI consumers.
 */
export function createLocationMapper(sourceFile: ts.SourceFile): LocationMapper {
  return (offset: number): SourceLocation => {
    const safeOffset = Math.max(0, Math.min(offset, sourceFile.text.length));
    const position = sourceFile.getLineAndCharacterOfPosition(safeOffset);

    return {
      line: position.line + 1,
      column: position.character + 1,
      offset: safeOffset,
    };
  };
}
