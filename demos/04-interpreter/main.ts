import { run } from "../../src/compiler.ts";

const source = await Bun.file(`${import.meta.dir}/program.netop`).text();
run(source, undefined, false);
