export type TokenKind =
  | "command"
  | "raw"
  | "newline"
  | "number"
  | "string"
  | "identifier"
  | "true"
  | "false"
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "="
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "!"
  | "&&"
  | "||"
  | "("
  | ")"
  | "["
  | "]"
  | ","
  | "eof";

export interface SourceLocation {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly location: SourceLocation;
}

export class CompileError extends Error {
  readonly location: SourceLocation;

  constructor(message: string, location: SourceLocation) {
    super(`${message} at ${location.line}:${location.column}`);
    this.name = "CompileError";
    this.location = location;
  }
}
