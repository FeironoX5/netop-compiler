import type { BinaryOperator, Expression, Program, Statement } from "./ast.ts";
import type { SourceLocation } from "./token.ts";

type RuntimeValue = number | string | boolean | RuntimeValue[] | FunctionValue | null;

interface FunctionValue {
  readonly kind: "function";
  readonly declaration: Extract<Statement, { kind: "function" }>;
  readonly closure: Environment;
}

class RuntimeError extends Error {
  constructor(message: string, location: SourceLocation) {
    super(`${message} at ${location.line}:${location.column}`);
    this.name = "RuntimeError";
  }
}

class ReturnSignal {
  readonly value: RuntimeValue;

  constructor(value: RuntimeValue) {
    this.value = value;
  }
}

class Environment {
  readonly #values = new Map<string, RuntimeValue>();
  readonly #parent: Environment | null;

  constructor(parent: Environment | null = null) {
    this.#parent = parent;
  }

  define(name: string, value: RuntimeValue, location: SourceLocation): void {
    if (this.#values.has(name)) throw new RuntimeError(`'${name}' is already defined`, location);
    this.#values.set(name, value);
  }

  get(name: string, location: SourceLocation): RuntimeValue {
    if (this.#values.has(name)) return this.#values.get(name) ?? null;
    if (this.#parent !== null) return this.#parent.get(name, location);
    throw new RuntimeError(`Undefined variable '${name}'`, location);
  }

  assign(name: string, value: RuntimeValue, location: SourceLocation): void {
    if (this.#values.has(name)) {
      this.#values.set(name, value);
      return;
    }
    if (this.#parent !== null) {
      this.#parent.assign(name, value, location);
      return;
    }
    throw new RuntimeError(`Undefined variable '${name}'`, location);
  }
}

export type OutputWriter = (line: string) => void;
export type CommandExecutor = (command: string) => string | null;

export class Interpreter {
  readonly #write: OutputWriter;
  readonly #executeCommand: CommandExecutor;
  #environment = new Environment();

  constructor(write: OutputWriter = console.log, executeCommand: CommandExecutor = (command) => command) {
    this.#write = write;
    this.#executeCommand = executeCommand;
  }

  run(program: Program): void {
    this.#environment = new Environment();
    this.#executeStatements(program.statements);
  }

  #executeStatements(statements: readonly Statement[]): void {
    for (const statement of statements) {
      if (statement.kind !== "function") continue;
      const value: FunctionValue = { kind: "function", declaration: statement, closure: this.#environment };
      this.#environment.define(statement.name, value, statement.location);
    }
    for (const statement of statements) {
      if (statement.kind !== "function") this.#execute(statement);
    }
  }

  #execute(statement: Statement): void {
    switch (statement.kind) {
      case "let":
        this.#environment.define(statement.name, statement.initializer === null ? null : this.#evaluate(statement.initializer), statement.location);
        return;
      case "print":
        this.#write(this.#format(this.#evaluate(statement.expression)));
        return;
      case "expression":
        this.#evaluate(statement.expression);
        return;
      case "block":
        this.#executeBlock(statement.statements, new Environment(this.#environment));
        return;
      case "if":
        if (this.#boolean(this.#evaluate(statement.condition), statement.condition.location)) this.#execute(statement.thenBranch);
        else if (statement.elseBranch !== null) this.#execute(statement.elseBranch);
        return;
      case "while":
        while (this.#boolean(this.#evaluate(statement.condition), statement.condition.location)) this.#execute(statement.body);
        return;
      case "function":
        return;
      case "return":
        throw new ReturnSignal(statement.value === null ? null : this.#evaluate(statement.value));
      case "command": {
        const prefix = statement.path.length === 0 ? "" : `${statement.path.join(":")}:`;
        const args = statement.arguments.length === 0 ? "" : ` ${statement.arguments.join(" ")}`;
        const result = this.#executeCommand(`${prefix}${statement.name}${args}`);
        if (result !== null) this.#write(result);
        return;
      }
    }
  }

  #executeBlock(statements: readonly Statement[], environment: Environment): void {
    const previous = this.#environment;
    this.#environment = environment;
    try {
      this.#executeStatements(statements);
    } finally {
      this.#environment = previous;
    }
  }

  #evaluate(expression: Expression): RuntimeValue {
    switch (expression.kind) {
      case "literal":
        return expression.value;
      case "variable":
        return this.#environment.get(expression.name, expression.location);
      case "assign": {
        const value = this.#evaluate(expression.value);
        this.#environment.assign(expression.name, value, expression.location);
        return value;
      }
      case "unary": {
        const operand = this.#evaluate(expression.operand);
        if (expression.operator === "-") return -this.#number(operand, expression.location);
        return !this.#boolean(operand, expression.location);
      }
      case "binary":
        return this.#binary(expression);
      case "call":
        return this.#call(expression);
      case "array":
        return expression.elements.map((element) => this.#evaluate(element));
      case "index": {
        const array = this.#array(this.#evaluate(expression.array), expression.array.location);
        return array[this.#index(this.#evaluate(expression.index), array.length, expression.index.location)] ?? null;
      }
      case "indexAssign": {
        const array = this.#array(this.#evaluate(expression.array), expression.array.location);
        const index = this.#index(this.#evaluate(expression.index), array.length, expression.index.location);
        const value = this.#evaluate(expression.value);
        array[index] = value;
        return value;
      }
    }
  }

  #binary(expression: Extract<Expression, { kind: "binary" }>): RuntimeValue {
    const left = this.#evaluate(expression.left);
    if (expression.operator === "&&") {
      return this.#boolean(left, expression.left.location) && this.#boolean(this.#evaluate(expression.right), expression.right.location);
    }
    if (expression.operator === "||") {
      return this.#boolean(left, expression.left.location) || this.#boolean(this.#evaluate(expression.right), expression.right.location);
    }
    const right = this.#evaluate(expression.right);
    if (expression.operator === "==") return this.#equal(left, right);
    if (expression.operator === "!=") return !this.#equal(left, right);
    if (expression.operator === "+" && typeof left === "string" && typeof right === "string") return left + right;
    const leftNumber = this.#number(left, expression.left.location);
    const rightNumber = this.#number(right, expression.right.location);
    return this.#numericBinary(expression.operator, leftNumber, rightNumber, expression.location);
  }

  #numericBinary(operator: BinaryOperator, left: number, right: number, location: SourceLocation): RuntimeValue {
    switch (operator) {
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/":
        if (right === 0) throw new RuntimeError("Division by zero", location);
        return left / right;
      case "%":
        if (right === 0) throw new RuntimeError("Division by zero", location);
        return left % right;
      case "<": return left < right;
      case "<=": return left <= right;
      case ">": return left > right;
      case ">=": return left >= right;
      case "==": return left === right;
      case "!=": return left !== right;
      case "&&":
      case "||":
        throw new RuntimeError(`Invalid numeric operator '${operator}'`, location);
    }
  }

  #call(expression: Extract<Expression, { kind: "call" }>): RuntimeValue {
    const argumentsList = expression.arguments.map((argument) => this.#evaluate(argument));
    if (expression.callee === "length") {
      if (argumentsList.length !== 1) throw new RuntimeError("length expects one argument", expression.location);
      const value = argumentsList[0];
      if (typeof value === "string" || Array.isArray(value)) return value.length;
      throw new RuntimeError("length expects an array or string", expression.location);
    }
    const callable = this.#environment.get(expression.callee, expression.location);
    if (!this.#isFunction(callable)) throw new RuntimeError(`'${expression.callee}' is not callable`, expression.location);
    if (argumentsList.length !== callable.declaration.parameters.length) {
      throw new RuntimeError(`Function '${expression.callee}' expects ${callable.declaration.parameters.length} arguments`, expression.location);
    }
    const callEnvironment = new Environment(callable.closure);
    callable.declaration.parameters.forEach((parameter, index) => {
      callEnvironment.define(parameter, argumentsList[index] ?? null, expression.location);
    });
    try {
      this.#executeBlock(callable.declaration.body.statements, callEnvironment);
    } catch (error: unknown) {
      if (error instanceof ReturnSignal) return error.value;
      throw error;
    }
    return null;
  }

  #number(value: RuntimeValue, location: SourceLocation): number {
    if (typeof value !== "number") throw new RuntimeError("Expected a number", location);
    return value;
  }

  #boolean(value: RuntimeValue, location: SourceLocation): boolean {
    if (typeof value !== "boolean") throw new RuntimeError("Expected a boolean", location);
    return value;
  }

  #array(value: RuntimeValue, location: SourceLocation): RuntimeValue[] {
    if (!Array.isArray(value)) throw new RuntimeError("Expected an array", location);
    return value;
  }

  #index(value: RuntimeValue, length: number, location: SourceLocation): number {
    const index = this.#number(value, location);
    if (!Number.isInteger(index)) throw new RuntimeError("Array index must be an integer", location);
    if (index < 0 || index >= length) throw new RuntimeError(`Array index ${index} is out of bounds for length ${length}`, location);
    return index;
  }

  #equal(left: RuntimeValue, right: RuntimeValue): boolean {
    return left === right;
  }

  #isFunction(value: RuntimeValue): value is FunctionValue {
    return typeof value === "object" && value !== null && !Array.isArray(value) && value.kind === "function";
  }

  #format(value: RuntimeValue): string {
    if (value === null) return "nil";
    if (Array.isArray(value)) return `[${value.map((element) => this.#format(element)).join(", ")}]`;
    if (this.#isFunction(value)) return `<fn ${value.declaration.name}>`;
    return String(value);
  }
}
