// Generates TypeScript types and runtime JSON Schemas from contracts/*.schema.json
// into src/contracts/generated/. Run after editing a contract: npm run contracts:generate
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from 'json-schema-to-typescript';

const contractsDirectory = fileURLToPath(new URL('../contracts/', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../src/contracts/generated/', import.meta.url));

const banner = (sourceFileName) =>
  `/* eslint-disable */\n/**\n * GENERATED from contracts/${sourceFileName} by scripts/generate-contract-types.mjs.\n * Do not edit by hand; edit the schema and run \`npm run contracts:generate\`.\n */`;

const toModuleName = (schemaFileName) => basename(schemaFileName, '.schema.json');
const toConstantName = (moduleName) =>
  moduleName
    .replace(/\.v(\d+)$/, '-v$1')
    .split(/[-.]/)
    .map((part) => part.toUpperCase())
    .join('_') + '_SCHEMA';

const toNamespaceName = (moduleName) =>
  moduleName
    .replace(/\.v(\d+)$/, '-v$1')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const schemaFileNames = (await readdir(contractsDirectory))
  .filter((name) => name.endsWith('.schema.json'))
  .sort();
const indexLines = [];
for (const schemaFileName of schemaFileNames) {
  const schema = JSON.parse(await readFile(join(contractsDirectory, schemaFileName), 'utf8'));
  const moduleName = toModuleName(schemaFileName);
  const types = await compile(structuredClone(schema), schema.title, {
    bannerComment: banner(schemaFileName),
    additionalProperties: false,
    unreachableDefinitions: true,
    strictIndexSignatures: true,
    format: true,
    style: { singleQuote: true, printWidth: 110 },
  });
  const constantName = toConstantName(moduleName);
  const runtimeSchema = `\n/** The JSON Schema itself, for runtime validation with Ajv. */\nexport const ${constantName} = ${JSON.stringify(schema, null, 2)} as const;\n`;
  await writeFile(join(outputDirectory, `${moduleName}.ts`), types + runtimeSchema);
  // Namespaced: each contract file defines its own small shared types (e.g. ObjectReference).
  indexLines.push(`export * as ${toNamespaceName(moduleName)} from './${moduleName}.js';`);
  process.stdout.write(`generated ${moduleName}.ts\n`);
}
// Flat re-export of the runtime schemas (constant names are unique, unlike type names).
await writeFile(
  join(outputDirectory, 'all-schemas.ts'),
  `${banner('*.schema.json')}\n${schemaFileNames
    .map((schemaFileName) => {
      const moduleName = toModuleName(schemaFileName);
      return `export { ${toConstantName(moduleName)} } from './${moduleName}.js';`;
    })
    .join('\n')}\n`,
);
await writeFile(join(outputDirectory, 'index.ts'), `${banner('*.schema.json')}\n${indexLines.join('\n')}\n`);
