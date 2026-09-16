import { parse } from "../../src/compiler.ts";

const source = await Bun.file(`${import.meta.dir}/program.netop`).text();
console.log(JSON.stringify(parse(source).program, null, 2));
