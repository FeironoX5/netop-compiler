import { parse, run } from "../../src/compiler.ts";
import { Optimizer } from "../../src/optimizer.ts";

const source = await Bun.file(`${import.meta.dir}/program.netop`).text();
const optimized = new Optimizer().optimize(parse(source).program);
console.log(JSON.stringify(optimized, null, 2));
console.log("--- output ---");
run(source);
