export type SmSymbolValue =
  | { readonly kind: 'unknown' }
  | {
    readonly kind: 'scfile';
    readonly bindingId: string;
    readonly aliasDepth: 0 | 1;
  }
  | {
    readonly kind: 'return-code';
    readonly resultId: string;
    readonly bindingId: string;
    readonly method: string;
  };

export const UNKNOWN_SYMBOL: SmSymbolValue = Object.freeze({ kind: 'unknown' });

interface SymbolScope {
  readonly id: string;
  readonly kind: 'global' | 'function' | 'block';
  readonly values: Map<string, SmSymbolValue>;
}

export interface SmSymbolSnapshot {
  resolve(name: string): SmSymbolValue | undefined;
}

export class SmSymbolTracker implements SmSymbolSnapshot {
  readonly #scopes: SymbolScope[];

  constructor(scopes?: readonly SymbolScope[]) {
    this.#scopes = scopes
      ? scopes.map(cloneScope)
      : [{ id: 'scope:global', kind: 'global', values: new Map() }];
  }

  clone(): SmSymbolTracker {
    return new SmSymbolTracker(this.#scopes);
  }

  snapshot(): SmSymbolSnapshot {
    const copy = this.clone();
    return { resolve: (name) => copy.resolve(name) };
  }

  currentScopeId(): string {
    return this.#currentScope().id;
  }

  enterScope(id: string, kind: SymbolScope['kind']): void {
    this.#scopes.push({ id, kind, values: new Map() });
  }

  leaveScope(): void {
    if (this.#scopes.length === 1) throw new Error('Cannot leave the global symbol scope');
    this.#scopes.pop();
  }

  declare(name: string, value: SmSymbolValue = UNKNOWN_SYMBOL, functionScoped = false): void {
    const scope = functionScoped ? this.#nearestFunctionScope() : this.#currentScope();
    if (!scope.values.has(name)) scope.values.set(name, value);
  }

  assign(name: string, value: SmSymbolValue): void {
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      if (this.#scopes[index].values.has(name)) {
        this.#scopes[index].values.set(name, value);
        return;
      }
    }
    this.#nearestFunctionScope().values.set(name, value);
  }

  resolve(name: string): SmSymbolValue | undefined {
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      const value = this.#scopes[index].values.get(name);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  joinBranches(left: SmSymbolTracker, right: SmSymbolTracker): void {
    for (let index = 0; index < this.#scopes.length; index += 1) {
      const target = this.#scopes[index];
      const leftScope = left.#scopes[index];
      const rightScope = right.#scopes[index];
      if (!leftScope || !rightScope) continue;

      for (const name of target.values.keys()) {
        const leftValue = leftScope.values.get(name) ?? UNKNOWN_SYMBOL;
        const rightValue = rightScope.values.get(name) ?? UNKNOWN_SYMBOL;
        target.values.set(name, sameSymbol(leftValue, rightValue) ? leftValue : UNKNOWN_SYMBOL);
      }
    }
  }

  #currentScope(): SymbolScope {
    return this.#scopes[this.#scopes.length - 1];
  }

  #nearestFunctionScope(): SymbolScope {
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      if (this.#scopes[index].kind !== 'block') return this.#scopes[index];
    }
    return this.#scopes[0];
  }
}

function cloneScope(scope: SymbolScope): SymbolScope {
  return { id: scope.id, kind: scope.kind, values: new Map(scope.values) };
}

function sameSymbol(left: SmSymbolValue, right: SmSymbolValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'unknown' && right.kind === 'unknown') return true;
  if (left.kind === 'scfile' && right.kind === 'scfile') {
    return left.bindingId === right.bindingId && left.aliasDepth === right.aliasDepth;
  }
  if (left.kind === 'return-code' && right.kind === 'return-code') {
    return left.resultId === right.resultId;
  }
  return false;
}

