import type { Program } from "./ast.ts";
import { Analyzer, type Diagnostic } from "./analyzer.ts";
import { Interpreter, type CommandExecutor, type OutputWriter } from "./interpreter.ts";
import { tokenize } from "./lexer.ts";
import { Optimizer } from "./optimizer.ts";
import { Parser } from "./parser.ts";
import type { Token } from "./token.ts";

export interface Compilation {
  readonly tokens: readonly Token[];
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
}

export function parse(source: string): { readonly tokens: readonly Token[]; readonly program: Program } {
  const tokens = tokenize(source);
  return { tokens, program: new Parser(tokens).parse() };
}

export function compile(source: string): Compilation {
  const parsed = parse(source);
  return { ...parsed, diagnostics: new Analyzer().analyze(parsed.program) };
}

export function run(source: string, write?: OutputWriter, optimize = true, executeCommand?: CommandExecutor): void {
  const result = compile(source);
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map(formatDiagnostic).join("\n"));
  }
  const program = optimize ? new Optimizer().optimize(result.program) : result.program;
  new Interpreter(write, executeCommand).run(program);
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.location.line}:${diagnostic.location.column} ${diagnostic.message}`;
}
