import { compile, formatDiagnostic } from "../../src/compiler.ts";

const source = await Bun.file(`${import.meta.dir}/program.netop`).text();
const result = compile(source);
result.diagnostics.forEach((diagnostic) => console.log(formatDiagnostic(diagnostic)));
