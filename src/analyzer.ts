import type { Expression, Program, Statement } from "./ast.ts";
import type { SourceLocation } from "./token.ts";

export type ValueType =
  | { readonly kind: "number" }
  | { readonly kind: "string" }
  | { readonly kind: "boolean" }
  | { readonly kind: "array"; readonly element: ValueType }
  | { readonly kind: "unknown" }
  | { readonly kind: "void" };

export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly location: SourceLocation;
}

interface VariableSymbol {
  readonly name: string;
  readonly location: SourceLocation;
  type: ValueType;
  initialized: boolean;
  used: boolean;
}

interface FunctionSymbol {
  readonly declaration: Extract<Statement, { kind: "function" }>;
  readonly parameterTypes: ValueType[];
  returnType: ValueType;
}

const numberType: ValueType = { kind: "number" };
const stringType: ValueType = { kind: "string" };
const booleanType: ValueType = { kind: "boolean" };
const unknownType: ValueType = { kind: "unknown" };
const voidType: ValueType = { kind: "void" };

export class Analyzer {
  readonly #diagnostics: Diagnostic[] = [];
  readonly #scopes: Map<string, VariableSymbol>[] = [];
  readonly #functions = new Map<string, FunctionSymbol>();
  #functionDepth = 0;
  #currentFunction: FunctionSymbol | null = null;

  analyze(program: Program): readonly Diagnostic[] {
    this.#diagnostics.length = 0;
    this.#scopes.length = 0;
    this.#functions.clear();
    this.#beginScope();
    this.#declareFunctions(program.statements);
    for (const statement of program.statements) this.#statement(statement);
    this.#endScope();
    return this.#diagnostics;
  }

  #declareFunctions(statements: readonly Statement[]): void {
    for (const statement of statements) {
      if (statement.kind !== "function") continue;
      if (this.#functions.has(statement.name)) {
        this.#report("error", `Function '${statement.name}' is already declared`, statement.location);
        continue;
      }
      this.#functions.set(statement.name, {
        declaration: statement,
        parameterTypes: statement.parameters.map(() => unknownType),
        returnType: unknownType,
      });
    }
  }

  #statement(statement: Statement): void {
    switch (statement.kind) {
      case "let": {
        const initializerType = statement.initializer === null ? unknownType : this.#expression(statement.initializer);
        this.#declareVariable(statement.name, initializerType, statement.initializer !== null, statement.location);
        return;
      }
      case "print":
      case "expression":
        this.#expression(statement.expression);
        return;
      case "block":
        this.#beginScope();
        this.#declareFunctions(statement.statements);
        for (const child of statement.statements) this.#statement(child);
        this.#endScope();
        return;
      case "if":
        this.#expect(this.#expression(statement.condition), booleanType, "If condition must be boolean", statement.condition.location);
        this.#statement(statement.thenBranch);
        if (statement.elseBranch !== null) this.#statement(statement.elseBranch);
        return;
      case "while":
        this.#expect(this.#expression(statement.condition), booleanType, "While condition must be boolean", statement.condition.location);
        this.#statement(statement.body);
        return;
      case "function":
        this.#function(statement);
        return;
      case "return": {
        if (this.#functionDepth === 0 || this.#currentFunction === null) {
          this.#report("error", "Return is only valid inside a function", statement.location);
          return;
        }
        const returnType = statement.value === null ? voidType : this.#expression(statement.value);
        if (this.#currentFunction.returnType.kind === "unknown") {
          this.#currentFunction.returnType = returnType;
        } else {
          this.#expect(returnType, this.#currentFunction.returnType, "Function returns incompatible types", statement.location);
        }
        return;
      }
      case "command":
        return;
    }
  }

  #function(statement: Extract<Statement, { kind: "function" }>): void {
    const symbol = this.#functions.get(statement.name);
    if (symbol === undefined || symbol.declaration !== statement) return;
    const previousFunction = this.#currentFunction;
    this.#currentFunction = symbol;
    this.#functionDepth += 1;
    this.#beginScope();
    const seen = new Set<string>();
    statement.parameters.forEach((parameter, index) => {
      if (seen.has(parameter)) {
        this.#report("error", `Duplicate parameter '${parameter}'`, statement.location);
        return;
      }
      seen.add(parameter);
      this.#declareVariable(parameter, symbol.parameterTypes[index] ?? unknownType, true, statement.location);
    });
    for (const child of statement.body.statements) this.#statement(child);
    this.#endScope();
    this.#functionDepth -= 1;
    this.#currentFunction = previousFunction;
  }

  #expression(expression: Expression): ValueType {
    switch (expression.kind) {
      case "literal":
        if (typeof expression.value === "number") return numberType;
        if (typeof expression.value === "string") return stringType;
        return booleanType;
      case "variable": {
        const symbol = this.#findVariable(expression.name);
        if (symbol === null) {
          this.#report("error", `Variable '${expression.name}' is not declared`, expression.location);
          return unknownType;
        }
        symbol.used = true;
        if (!symbol.initialized) this.#report("error", `Variable '${expression.name}' is not initialized`, expression.location);
        return symbol.type;
      }
      case "assign": {
        const valueType = this.#expression(expression.value);
        const symbol = this.#findVariable(expression.name);
        if (symbol === null) {
          this.#report("error", `Variable '${expression.name}' is not declared`, expression.location);
          return unknownType;
        }
        if (symbol.type.kind !== "unknown") this.#expect(valueType, symbol.type, `Cannot assign a different type to '${expression.name}'`, expression.location);
        else symbol.type = valueType;
        symbol.initialized = true;
        return valueType;
      }
      case "unary": {
        const operand = this.#expression(expression.operand);
        const expected = expression.operator === "-" ? numberType : booleanType;
        this.#expect(operand, expected, `Operator '${expression.operator}' received the wrong type`, expression.location);
        return expected;
      }
      case "binary":
        return this.#binary(expression);
      case "call":
        return this.#call(expression);
      case "array": {
        if (expression.elements.length === 0) return { kind: "array", element: unknownType };
        const firstElement = expression.elements[0];
        if (firstElement === undefined) return { kind: "array", element: unknownType };
        const elementType = this.#expression(firstElement);
        for (const element of expression.elements.slice(1)) {
          this.#expect(this.#expression(element), elementType, "Array elements must have the same type", element.location);
        }
        return { kind: "array", element: elementType };
      }
      case "index": {
        const arrayType = this.#expression(expression.array);
        this.#expect(this.#expression(expression.index), numberType, "Array index must be a number", expression.index.location);
        if (arrayType.kind === "array") return arrayType.element;
        if (arrayType.kind !== "unknown") this.#report("error", "Only arrays can be indexed", expression.array.location);
        return unknownType;
      }
      case "indexAssign": {
        const arrayType = this.#expression(expression.array);
        this.#expect(this.#expression(expression.index), numberType, "Array index must be a number", expression.index.location);
        const valueType = this.#expression(expression.value);
        if (arrayType.kind === "array") {
          this.#expect(valueType, arrayType.element, "Assigned value has the wrong array element type", expression.value.location);
        } else if (arrayType.kind !== "unknown") {
          this.#report("error", "Only arrays can be indexed", expression.array.location);
        }
        return valueType;
      }
    }
  }

  #binary(expression: Extract<Expression, { kind: "binary" }>): ValueType {
    const left = this.#expression(expression.left);
    const right = this.#expression(expression.right);
    if (expression.operator === "&&" || expression.operator === "||") {
      this.#expect(left, booleanType, `Operator '${expression.operator}' requires booleans`, expression.left.location);
      this.#expect(right, booleanType, `Operator '${expression.operator}' requires booleans`, expression.right.location);
      return booleanType;
    }
    if (expression.operator === "==" || expression.operator === "!=") {
      this.#expect(right, left, "Compared values must have the same type", expression.location);
      return booleanType;
    }
    if (["<", "<=", ">", ">="].includes(expression.operator)) {
      this.#expect(left, numberType, `Operator '${expression.operator}' requires numbers`, expression.left.location);
      this.#expect(right, numberType, `Operator '${expression.operator}' requires numbers`, expression.right.location);
      return booleanType;
    }
    if (expression.operator === "+" && left.kind === "string") {
      this.#expect(right, stringType, "String concatenation requires two strings", expression.right.location);
      return stringType;
    }
    this.#expect(left, numberType, `Operator '${expression.operator}' requires numbers`, expression.left.location);
    this.#expect(right, numberType, `Operator '${expression.operator}' requires numbers`, expression.right.location);
    return numberType;
  }

  #call(expression: Extract<Expression, { kind: "call" }>): ValueType {
    const argumentTypes = expression.arguments.map((argument) => this.#expression(argument));
    if (expression.callee === "length") {
      if (argumentTypes.length !== 1) this.#report("error", "length expects exactly one argument", expression.location);
      const argumentType = argumentTypes[0];
      if (argumentType !== undefined && argumentType.kind !== "array" && argumentType.kind !== "string" && argumentType.kind !== "unknown") {
        this.#report("error", "length expects an array or string", expression.location);
      }
      return numberType;
    }
    const symbol = this.#functions.get(expression.callee);
    if (symbol === undefined) {
      this.#report("error", `Function '${expression.callee}' is not declared`, expression.location);
      return unknownType;
    }
    if (argumentTypes.length !== symbol.parameterTypes.length) {
      this.#report("error", `Function '${expression.callee}' expects ${symbol.parameterTypes.length} arguments, got ${argumentTypes.length}`, expression.location);
    }
    argumentTypes.forEach((argumentType, index) => {
      const parameterType = symbol.parameterTypes[index];
      if (parameterType === undefined) return;
      if (parameterType.kind === "unknown") symbol.parameterTypes[index] = argumentType;
      else this.#expect(argumentType, parameterType, `Argument ${index + 1} has the wrong type`, expression.arguments[index]?.location ?? expression.location);
    });
    return symbol.returnType;
  }

  #expect(actual: ValueType, expected: ValueType, message: string, location: SourceLocation): void {
    if (!this.#compatible(actual, expected)) this.#report("error", `${message}: expected ${this.#describe(expected)}, got ${this.#describe(actual)}`, location);
  }

  #compatible(left: ValueType, right: ValueType): boolean {
    if (left.kind === "unknown" || right.kind === "unknown") return true;
    if (left.kind !== right.kind) return false;
    if (left.kind === "array" && right.kind === "array") return this.#compatible(left.element, right.element);
    return true;
  }

  #describe(type: ValueType): string {
    return type.kind === "array" ? `array<${this.#describe(type.element)}>` : type.kind;
  }

  #declareVariable(name: string, type: ValueType, initialized: boolean, location: SourceLocation): void {
    const scope = this.#scopes.at(-1);
    if (scope === undefined) throw new Error("Analyzer scope stack is empty");
    if (scope.has(name)) {
      this.#report("error", `Variable '${name}' is already declared in this scope`, location);
      return;
    }
    scope.set(name, { name, type, initialized, used: false, location });
  }

  #findVariable(name: string): VariableSymbol | null {
    for (let index = this.#scopes.length - 1; index >= 0; index -= 1) {
      const symbol = this.#scopes[index]?.get(name);
      if (symbol !== undefined) return symbol;
    }
    return null;
  }

  #beginScope(): void {
    this.#scopes.push(new Map());
  }

  #endScope(): void {
    const scope = this.#scopes.pop();
    if (scope === undefined) throw new Error("Analyzer scope stack is empty");
    for (const symbol of scope.values()) {
      if (!symbol.used) this.#report("warning", `Variable '${symbol.name}' is declared but never used`, symbol.location);
    }
  }

  #report(severity: Diagnostic["severity"], message: string, location: SourceLocation): void {
    this.#diagnostics.push({ severity, message, location });
  }
}
