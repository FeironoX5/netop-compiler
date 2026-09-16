import type { BinaryOperator, Expression, Program, Statement } from "./ast.ts";
import { CompileError, type Token, type TokenKind } from "./token.ts";

const binaryPrecedence: Partial<Record<TokenKind, number>> = {
  "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6,
};

export class Parser {
  readonly #tokens: readonly Token[];
  #current = 0;

  constructor(tokens: readonly Token[]) {
    this.#tokens = tokens;
  }

  parse(): Program {
    const statements: Statement[] = [];
    this.#skipNewlines();
    while (!this.#check("eof")) {
      statements.push(this.#statement());
      this.#skipNewlines();
    }
    return { kind: "program", statements };
  }

  #statement(): Statement {
    const command = this.#consume("command", "Expected a command");
    switch (command.lexeme) {
      case "var:let": return this.#letCommand(command);
      case "var:set": return this.#setCommand(command);
      case "io:print": return this.#printCommand(command);
      case "flow:if": return this.#ifCommand(command);
      case "flow:while": return this.#whileCommand(command);
      case "fn:define": return this.#functionCommand(command);
      case "fn:return": return this.#returnCommand(command);
      case "flow:else":
      case "flow:end":
      case "fn:end":
        throw new CompileError(`Unexpected '${command.lexeme}'`, command.location);
      default: return this.#externalCommand(command);
    }
  }

  #letCommand(command: Token): Statement {
    const name = this.#consume("identifier", "Expected a variable name");
    const initializer = this.#atLineEnd() ? null : this.#expression();
    this.#finishLine();
    return { kind: "let", name: name.lexeme, initializer, location: command.location };
  }

  #setCommand(command: Token): Statement {
    const target = this.#postfix();
    if (this.#atLineEnd()) throw new CompileError("Expected a value", command.location);
    const value = this.#expression();
    this.#finishLine();
    if (target.kind === "variable") {
      return {
        kind: "expression",
        expression: { kind: "assign", name: target.name, value, location: target.location },
        location: command.location,
      };
    }
    if (target.kind === "index") {
      return {
        kind: "expression",
        expression: { kind: "indexAssign", array: target.array, index: target.index, value, location: target.location },
        location: command.location,
      };
    }
    throw new CompileError("var:set target must be a variable or array index", target.location);
  }

  #printCommand(command: Token): Statement {
    if (this.#atLineEnd()) throw new CompileError("io:print expects a value", command.location);
    const expression = this.#expression();
    this.#finishLine();
    return { kind: "print", expression, location: command.location };
  }

  #ifCommand(command: Token): Statement {
    const condition = this.#expression();
    this.#finishLine();
    const thenStatements = this.#statementsUntil(new Set(["flow:else", "flow:end"]));
    const thenBranch: Extract<Statement, { kind: "block" }> = {
      kind: "block", statements: thenStatements, location: command.location,
    };
    let elseBranch: Statement | null = null;
    if (this.#peekCommand() === "flow:else") {
      const elseCommand = this.#advance();
      this.#finishLine();
      elseBranch = {
        kind: "block",
        statements: this.#statementsUntil(new Set(["flow:end"])),
        location: elseCommand.location,
      };
    }
    this.#consumeCommand("flow:end", "Expected flow:end after flow:if");
    this.#finishLine();
    return { kind: "if", condition, thenBranch, elseBranch, location: command.location };
  }

  #whileCommand(command: Token): Statement {
    const condition = this.#expression();
    this.#finishLine();
    const statements = this.#statementsUntil(new Set(["flow:end"]));
    this.#consumeCommand("flow:end", "Expected flow:end after flow:while");
    this.#finishLine();
    return {
      kind: "while",
      condition,
      body: { kind: "block", statements, location: command.location },
      location: command.location,
    };
  }

  #functionCommand(command: Token): Statement {
    const name = this.#consume("identifier", "Expected a function name");
    const parameters: string[] = [];
    while (!this.#atLineEnd()) parameters.push(this.#consume("identifier", "Expected a parameter name").lexeme);
    this.#finishLine();
    const statements = this.#statementsUntil(new Set(["fn:end"]));
    this.#consumeCommand("fn:end", "Expected fn:end after function body");
    this.#finishLine();
    return {
      kind: "function",
      name: name.lexeme,
      parameters,
      body: { kind: "block", statements, location: command.location },
      location: command.location,
    };
  }

  #returnCommand(command: Token): Statement {
    const value = this.#atLineEnd() ? null : this.#expression();
    this.#finishLine();
    return { kind: "return", value, location: command.location };
  }

  #externalCommand(command: Token): Statement {
    const segments = command.lexeme.split(":");
    const name = segments.at(-1);
    if (name === undefined) throw new CompileError("Command name is missing", command.location);
    const args: string[] = [];
    while (!this.#atLineEnd()) args.push(this.#consume("raw", "Expected a raw command argument").lexeme);
    this.#finishLine();
    return { kind: "command", path: segments.slice(0, -1), name, arguments: args, location: command.location };
  }

  #statementsUntil(endCommands: ReadonlySet<string>): readonly Statement[] {
    const statements: Statement[] = [];
    this.#skipNewlines();
    while (!this.#check("eof") && !endCommands.has(this.#peekCommand() ?? "")) {
      statements.push(this.#statement());
      this.#skipNewlines();
    }
    return statements;
  }

  #expression(): Expression {
    return this.#binary(1);
  }

  #binary(minimumPrecedence: number): Expression {
    let left = this.#unary();
    for (;;) {
      const operator = this.#peek();
      const precedence = binaryPrecedence[operator.kind];
      if (precedence === undefined || precedence < minimumPrecedence) break;
      this.#advance();
      const right = this.#binary(precedence + 1);
      left = {
        kind: "binary", left, operator: operator.kind as BinaryOperator, right, location: operator.location,
      };
    }
    return left;
  }

  #unary(): Expression {
    if (this.#match("!", "-")) {
      const operator = this.#previous();
      return {
        kind: "unary",
        operator: operator.kind as "-" | "!",
        operand: this.#unary(),
        location: operator.location,
      };
    }
    return this.#postfix();
  }

  #postfix(): Expression {
    let expression = this.#primary();
    for (;;) {
      if (this.#match("(")) {
        if (expression.kind !== "variable") throw new CompileError("Only named functions can be called", expression.location);
        const argumentsList: Expression[] = [];
        if (!this.#check(")")) {
          do argumentsList.push(this.#expression()); while (this.#match(","));
        }
        this.#consume(")", "Expected ')' after arguments");
        expression = { kind: "call", callee: expression.name, arguments: argumentsList, location: expression.location };
        continue;
      }
      if (this.#match("[")) {
        const bracket = this.#previous();
        const index = this.#expression();
        this.#consume("]", "Expected ']' after index");
        expression = { kind: "index", array: expression, index, location: bracket.location };
        continue;
      }
      return expression;
    }
  }

  #primary(): Expression {
    if (this.#match("number")) {
      const token = this.#previous();
      return { kind: "literal", value: Number(token.lexeme), location: token.location };
    }
    if (this.#match("string")) {
      const token = this.#previous();
      return { kind: "literal", value: token.lexeme, location: token.location };
    }
    if (this.#match("true", "false")) {
      const token = this.#previous();
      return { kind: "literal", value: token.kind === "true", location: token.location };
    }
    if (this.#match("identifier")) {
      const token = this.#previous();
      return { kind: "variable", name: token.lexeme, location: token.location };
    }
    if (this.#match("(")) {
      const expression = this.#expression();
      this.#consume(")", "Expected ')' after expression");
      return expression;
    }
    if (this.#match("[")) {
      const bracket = this.#previous();
      const elements: Expression[] = [];
      if (!this.#check("]")) {
        do elements.push(this.#expression()); while (this.#match(","));
      }
      this.#consume("]", "Expected ']' after array literal");
      return { kind: "array", elements, location: bracket.location };
    }
    throw new CompileError("Expected expression", this.#peek().location);
  }

  #finishLine(): void {
    if (this.#match("newline")) return;
    if (!this.#check("eof")) throw new CompileError("Expected end of command line", this.#peek().location);
  }

  #skipNewlines(): void {
    while (this.#match("newline")) { /* blank line */ }
  }

  #atLineEnd(): boolean {
    return this.#check("newline") || this.#check("eof");
  }

  #peekCommand(): string | null {
    return this.#check("command") ? this.#peek().lexeme : null;
  }

  #consumeCommand(command: string, message: string): Token {
    if (this.#peekCommand() === command) return this.#advance();
    throw new CompileError(message, this.#peek().location);
  }

  #match(...kinds: readonly TokenKind[]): boolean {
    for (const kind of kinds) {
      if (!this.#check(kind)) continue;
      this.#advance();
      return true;
    }
    return false;
  }

  #consume(kind: TokenKind, message: string): Token {
    if (this.#check(kind)) return this.#advance();
    throw new CompileError(message, this.#peek().location);
  }

  #check(kind: TokenKind): boolean {
    return this.#peek().kind === kind;
  }

  #advance(): Token {
    if (!this.#check("eof")) this.#current += 1;
    return this.#previous();
  }

  #peek(): Token {
    const token = this.#tokens[this.#current];
    if (token === undefined) throw new Error("Token stream must end with eof");
    return token;
  }

  #previous(): Token {
    const token = this.#tokens[this.#current - 1];
    if (token === undefined) throw new Error("No previous token");
    return token;
  }
}
