import { tokenize } from "../../src/lexer.ts";

const source = await Bun.file(`${import.meta.dir}/program.netop`).text();
console.table(tokenize(source).map(({ kind, lexeme, location }) => ({ kind, lexeme, line: location.line, column: location.column })));
