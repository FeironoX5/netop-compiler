import { CompileError, type SourceLocation, type Token, type TokenKind } from "./token.ts";

const keywords: Readonly<Record<string, TokenKind>> = { true: "true", false: "false" };

const languageCommands = new Set([
  "var:let", "var:set", "io:print", "flow:if", "flow:else", "flow:while", "flow:end",
  "fn:define", "fn:return", "fn:end",
]);

const twoCharacterTokens = new Set<TokenKind>(["==", "!=", "<=", ">=", "&&", "||"]);
const oneCharacterTokens = new Set<TokenKind>([
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "(", ")", "[", "]", ",",
]);

export class Lexer {
  readonly #source: string;
  #offset = 0;
  #line = 1;
  #column = 1;
  #lineStart = true;
  #rawArguments = false;

  constructor(source: string) {
    this.#source = source;
  }

  scan(): Token[] {
    const tokens: Token[] = [];
    while (!this.#atEnd()) {
      this.#skipHorizontalSpaceAndComments();
      if (this.#atEnd()) break;
      if (this.#peek() === "\n") {
        const location = this.#location();
        this.#advance();
        tokens.push({ kind: "newline", lexeme: "\n", location });
        this.#lineStart = true;
        this.#rawArguments = false;
        continue;
      }
      if (this.#lineStart) {
        const command = this.#command();
        tokens.push(command);
        this.#lineStart = false;
        this.#rawArguments = !languageCommands.has(command.lexeme);
        continue;
      }
      tokens.push(this.#rawArguments ? this.#raw() : this.#scanExpressionToken());
    }
    tokens.push({ kind: "eof", lexeme: "", location: this.#location() });
    return tokens;
  }

  #command(): Token {
    const location = this.#location();
    const start = this.#offset;
    while (!this.#atEnd() && !/\s/.test(this.#peek())) this.#advance();
    const lexeme = this.#source.slice(start, this.#offset);
    if (!/^[A-Za-z_][\w-]*(?::[A-Za-z_][\w-]*)+$/.test(lexeme)) {
      throw new CompileError("Expected command in [path:]name form", location);
    }
    return { kind: "command", lexeme, location };
  }

  #raw(): Token {
    const location = this.#location();
    const start = this.#offset;
    while (!this.#atEnd() && !/\s/.test(this.#peek())) this.#advance();
    return { kind: "raw", lexeme: this.#source.slice(start, this.#offset), location };
  }

  #scanExpressionToken(): Token {
    const location = this.#location();
    const first = this.#peek();
    if (this.#isDigit(first)) return this.#number(location);
    if (this.#isIdentifierStart(first)) return this.#identifier(location);
    if (first === '"') return this.#string(location);

    const pair = `${first}${this.#peek(1)}` as TokenKind;
    if (twoCharacterTokens.has(pair)) {
      this.#advance();
      this.#advance();
      return { kind: pair, lexeme: pair, location };
    }
    const kind = first as TokenKind;
    if (oneCharacterTokens.has(kind)) {
      this.#advance();
      return { kind, lexeme: first, location };
    }
    throw new CompileError(`Unexpected character ${JSON.stringify(first)}`, location);
  }

  #number(location: SourceLocation): Token {
    const start = this.#offset;
    while (this.#isDigit(this.#peek())) this.#advance();
    if (this.#peek() === "." && this.#isDigit(this.#peek(1))) {
      this.#advance();
      while (this.#isDigit(this.#peek())) this.#advance();
    }
    return { kind: "number", lexeme: this.#source.slice(start, this.#offset), location };
  }

  #identifier(location: SourceLocation): Token {
    const start = this.#offset;
    while (this.#isIdentifierPart(this.#peek())) this.#advance();
    const lexeme = this.#source.slice(start, this.#offset);
    return { kind: keywords[lexeme] ?? "identifier", lexeme, location };
  }

  #string(location: SourceLocation): Token {
    this.#advance();
    let value = "";
    while (!this.#atEnd() && this.#peek() !== '"') {
      if (this.#peek() === "\n") throw new CompileError("Unterminated string", location);
      if (this.#peek() === "\\") {
        this.#advance();
        const escaped = this.#advance();
        const escapes: Readonly<Record<string, string>> = { n: "\n", t: "\t", '"': '"', "\\": "\\" };
        value += escapes[escaped] ?? escaped;
      } else {
        value += this.#advance();
      }
    }
    if (this.#atEnd()) throw new CompileError("Unterminated string", location);
    this.#advance();
    return { kind: "string", lexeme: value, location };
  }

  #skipHorizontalSpaceAndComments(): void {
    for (;;) {
      while (this.#peek() === " " || this.#peek() === "\t" || this.#peek() === "\r") this.#advance();
      if (this.#peek() !== "#") return;
      while (!this.#atEnd() && this.#peek() !== "\n") this.#advance();
    }
  }

  #peek(ahead = 0): string {
    return this.#source[this.#offset + ahead] ?? "\0";
  }

  #advance(): string {
    const character = this.#peek();
    if (character === "\0") return character;
    this.#offset += 1;
    if (character === "\n") {
      this.#line += 1;
      this.#column = 1;
    } else {
      this.#column += 1;
    }
    return character;
  }

  #atEnd(): boolean {
    return this.#offset >= this.#source.length;
  }

  #location(): SourceLocation {
    return { offset: this.#offset, line: this.#line, column: this.#column };
  }

  #isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }

  #isIdentifierStart(character: string): boolean {
    return /[A-Za-z_]/.test(character);
  }

  #isIdentifierPart(character: string): boolean {
    return /[A-Za-z0-9_]/.test(character);
  }
}

export function tokenize(source: string): Token[] {
  return new Lexer(source).scan();
}
