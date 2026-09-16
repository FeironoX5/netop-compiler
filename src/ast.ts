import type { SourceLocation, TokenKind } from "./token.ts";

export type LiteralValue = number | string | boolean;

export type Expression =
  | { readonly kind: "literal"; readonly value: LiteralValue; readonly location: SourceLocation }
  | { readonly kind: "variable"; readonly name: string; readonly location: SourceLocation }
  | { readonly kind: "unary"; readonly operator: "-" | "!"; readonly operand: Expression; readonly location: SourceLocation }
  | { readonly kind: "binary"; readonly left: Expression; readonly operator: BinaryOperator; readonly right: Expression; readonly location: SourceLocation }
  | { readonly kind: "call"; readonly callee: string; readonly arguments: readonly Expression[]; readonly location: SourceLocation }
  | { readonly kind: "array"; readonly elements: readonly Expression[]; readonly location: SourceLocation }
  | { readonly kind: "index"; readonly array: Expression; readonly index: Expression; readonly location: SourceLocation }
  | { readonly kind: "assign"; readonly name: string; readonly value: Expression; readonly location: SourceLocation }
  | { readonly kind: "indexAssign"; readonly array: Expression; readonly index: Expression; readonly value: Expression; readonly location: SourceLocation };

export type BinaryOperator = Extract<TokenKind, "+" | "-" | "*" | "/" | "%" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||">;

export type Statement =
  | { readonly kind: "let"; readonly name: string; readonly initializer: Expression | null; readonly location: SourceLocation }
  | { readonly kind: "print"; readonly expression: Expression; readonly location: SourceLocation }
  | { readonly kind: "expression"; readonly expression: Expression; readonly location: SourceLocation }
  | { readonly kind: "block"; readonly statements: readonly Statement[]; readonly location: SourceLocation }
  | { readonly kind: "if"; readonly condition: Expression; readonly thenBranch: Statement; readonly elseBranch: Statement | null; readonly location: SourceLocation }
  | { readonly kind: "while"; readonly condition: Expression; readonly body: Statement; readonly location: SourceLocation }
  | { readonly kind: "function"; readonly name: string; readonly parameters: readonly string[]; readonly body: Extract<Statement, { kind: "block" }>; readonly location: SourceLocation }
  | { readonly kind: "return"; readonly value: Expression | null; readonly location: SourceLocation }
  | { readonly kind: "command"; readonly path: readonly string[]; readonly name: string; readonly arguments: readonly string[]; readonly location: SourceLocation };

export interface Program {
  readonly kind: "program";
  readonly statements: readonly Statement[];
}
