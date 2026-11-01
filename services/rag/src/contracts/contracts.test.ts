import { describe, expect, it } from 'vitest';

import { createJobEnvelope } from '../queue/job-envelope.js';
import { createContractValidator } from './contract-validator.js';
import {
  BLOCK_MANIFEST_RECORD_V1_SCHEMA,
  JOB_ENVELOPE_V1_SCHEMA,
  PARSE_INSPECT_V1_SCHEMA,
  PARSE_PAGES_V1_SCHEMA,
} from './generated/all-schemas.js';

type SchemaDocument = { $id: string; examples: readonly unknown[]; $defs?: Record<string, unknown> };

const documentSchemas = [JOB_ENVELOPE_V1_SCHEMA, BLOCK_MANIFEST_RECORD_V1_SCHEMA] as const;
/** Queue contracts: examples are `{ payload, result }` pairs validated against the named $defs. */
const queueContracts = [
  {
    schema: PARSE_INSPECT_V1_SCHEMA,
    payloadDefinition: 'ParseInspectPayload',
    resultDefinition: 'ParseInspectResult',
  },
  {
    schema: PARSE_PAGES_V1_SCHEMA,
    payloadDefinition: 'ParsePagesPayload',
    resultDefinition: 'ParsePagesResult',
  },
] as const;

describe('contracts/*.schema.json', () => {
  const ajv = createContractValidator();
  for (const schema of [...documentSchemas, ...queueContracts.map(({ schema }) => schema)]) {
    ajv.addSchema(schema);
  }

  it.each(documentSchemas.map((schema) => [schema.$id, schema] as const))(
    '%s: every example is valid',
    (_schemaId, schema: SchemaDocument) => {
      const validate = ajv.getSchema(schema.$id)!;
      for (const example of schema.examples) {
        expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
      }
    },
  );

  it.each(queueContracts.map((contract) => [contract.schema.$id, contract] as const))(
    '%s: every example payload and result is valid',
    (_schemaId, { schema, payloadDefinition, resultDefinition }) => {
      const validatePayload = ajv.getSchema(`${schema.$id}#/$defs/${payloadDefinition}`)!;
      const validateResult = ajv.getSchema(`${schema.$id}#/$defs/${resultDefinition}`)!;
      for (const example of schema.examples as readonly { payload: unknown; result: unknown }[]) {
        expect(validatePayload(example.payload), JSON.stringify(validatePayload.errors)).toBe(true);
        expect(validateResult(example.result), JSON.stringify(validateResult.errors)).toBe(true);
      }
    },
  );

  it('the envelope produced by rag satisfies the published envelope schema', () => {
    const validate = ajv.getSchema(JOB_ENVELOPE_V1_SCHEMA.$id)!;
    const envelope = JSON.parse(
      JSON.stringify(createJobEnvelope({ documentId: 'x' }, 'request-1')),
    ) as unknown;

    expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects a manifest record whose bounding box leaves the page', () => {
    const validate = ajv.getSchema(BLOCK_MANIFEST_RECORD_V1_SCHEMA.$id)!;
    const [validRecord] = BLOCK_MANIFEST_RECORD_V1_SCHEMA.examples;

    expect(validate({ ...validRecord, bbox: { x0: 0, y0: 0, x1: 1.4, y1: 1 } })).toBe(false);
  });
});
