import type { BinaryOperator, Expression, LiteralValue, Program, Statement } from "./ast.ts";

export class Optimizer {
  optimize(program: Program): Program {
    return { kind: "program", statements: this.#statements(program.statements) };
  }

  #statements(statements: readonly Statement[]): readonly Statement[] {
    const optimized: Statement[] = [];
    for (const statement of statements) {
      const result = this.#statement(statement);
      if (result !== null) optimized.push(result);
      if (result?.kind === "return") break;
    }
    return optimized;
  }

  #statement(statement: Statement): Statement | null {
    switch (statement.kind) {
      case "let":
        return { ...statement, initializer: statement.initializer === null ? null : this.#expression(statement.initializer) };
      case "print":
      case "expression":
        return { ...statement, expression: this.#expression(statement.expression) };
      case "block":
        return { ...statement, statements: this.#statements(statement.statements) };
      case "if": {
        const condition = this.#expression(statement.condition);
        const thenBranch = this.#statement(statement.thenBranch);
        const elseBranch = statement.elseBranch === null ? null : this.#statement(statement.elseBranch);
        if (condition.kind === "literal" && typeof condition.value === "boolean") {
          return condition.value ? thenBranch : elseBranch;
        }
        if (thenBranch === null) return elseBranch;
        return { ...statement, condition, thenBranch, elseBranch };
      }
      case "while": {
        const condition = this.#expression(statement.condition);
        if (condition.kind === "literal" && condition.value === false) return null;
        const body = this.#statement(statement.body);
        if (body === null) return null;
        return { ...statement, condition, body };
      }
      case "function": {
        const statements = this.#statements(statement.body.statements);
        return { ...statement, body: { ...statement.body, statements } };
      }
      case "return":
        return { ...statement, value: statement.value === null ? null : this.#expression(statement.value) };
      case "command":
        return statement;
    }
  }

  #expression(expression: Expression): Expression {
    switch (expression.kind) {
      case "literal":
      case "variable":
        return expression;
      case "unary": {
        const operand = this.#expression(expression.operand);
        if (operand.kind === "literal") {
          if (expression.operator === "-" && typeof operand.value === "number") {
            return { kind: "literal", value: -operand.value, location: expression.location };
          }
          if (expression.operator === "!" && typeof operand.value === "boolean") {
            return { kind: "literal", value: !operand.value, location: expression.location };
          }
        }
        return { ...expression, operand };
      }
      case "binary": {
        const left = this.#expression(expression.left);
        const right = this.#expression(expression.right);
        if (left.kind === "literal" && right.kind === "literal") {
          const value = this.#foldBinary(expression.operator, left.value, right.value);
          if (value !== null) return { kind: "literal", value, location: expression.location };
        }
        return { ...expression, left, right };
      }
      case "call":
        return { ...expression, arguments: expression.arguments.map((argument) => this.#expression(argument)) };
      case "array":
        return { ...expression, elements: expression.elements.map((element) => this.#expression(element)) };
      case "index":
        return { ...expression, array: this.#expression(expression.array), index: this.#expression(expression.index) };
      case "assign":
        return { ...expression, value: this.#expression(expression.value) };
      case "indexAssign":
        return {
          ...expression,
          array: this.#expression(expression.array),
          index: this.#expression(expression.index),
          value: this.#expression(expression.value),
        };
    }
  }

  #foldBinary(operator: BinaryOperator, left: LiteralValue, right: LiteralValue): LiteralValue | null {
    if (operator === "==") return left === right;
    if (operator === "!=") return left !== right;
    if (operator === "&&" && typeof left === "boolean" && typeof right === "boolean") return left && right;
    if (operator === "||" && typeof left === "boolean" && typeof right === "boolean") return left || right;
    if (operator === "+" && typeof left === "string" && typeof right === "string") return left + right;
    if (typeof left !== "number" || typeof right !== "number") return null;
    switch (operator) {
      case "+": return left + right;
      case "-": return left - right;
      case "*": return left * right;
      case "/": return right === 0 ? null : left / right;
      case "%": return right === 0 ? null : left % right;
      case "<": return left < right;
      case "<=": return left <= right;
      case ">": return left > right;
      case ">=": return left >= right;
      case "&&":
      case "||":
        return null;
    }
  }
}
