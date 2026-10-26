import ts from 'typescript';

export function statementDefinitelyTerminates(statement: ts.Statement): boolean {
  if (
    ts.isReturnStatement(statement)
    || ts.isThrowStatement(statement)
    || ts.isBreakStatement(statement)
    || ts.isContinueStatement(statement)
  ) {
    return true;
  }

  if (ts.isBlock(statement)) return statementListDefinitelyTerminates(statement.statements);

  if (ts.isIfStatement(statement) && statement.elseStatement) {
    return statementDefinitelyTerminates(statement.thenStatement)
      && statementDefinitelyTerminates(statement.elseStatement);
  }

  // Switch-wide and try/catch/finally completion require path-sensitive
  // handling. They are intentionally excluded from this safe subset. Their
  // nested blocks and individual switch clauses are still inspected by the
  // rule visitor for local statements following a direct exit.
  return false;
}

function statementListDefinitelyTerminates(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (statementDefinitelyTerminates(statement)) return true;
  }
  return false;
}

