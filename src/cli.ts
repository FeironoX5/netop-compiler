import { compile, formatDiagnostic, run } from "./compiler.ts";
import { Optimizer } from "./optimizer.ts";

const [command, path] = Bun.argv.slice(2);

if (command === undefined || path === undefined || !["tokens", "ast", "check", "optimize", "run"].includes(command)) {
  console.error("Usage: bun src/cli.ts <tokens|ast|check|optimize|run> <file.netop>");
  process.exitCode = 1;
} else if (!path.endsWith(".netop")) {
  console.error("Netop source files must use the .netop extension");
  process.exitCode = 1;
} else {
  const source = await Bun.file(path).text();
  const result = compile(source);
  if (command === "tokens") console.log(JSON.stringify(result.tokens, null, 2));
  if (command === "ast") console.log(JSON.stringify(result.program, null, 2));
  if (command === "check") result.diagnostics.forEach((diagnostic) => console.log(formatDiagnostic(diagnostic)));
  if (command === "optimize") console.log(JSON.stringify(new Optimizer().optimize(result.program), null, 2));
  if (command === "run") run(source);
}
