import type { ValidateFunction } from 'ajv/dist/2020.js';

import { PermanentJobError } from '../queue/permanent-job-error.js';
import { createContractValidator } from './contract-validator.js';
import {
  BLOCK_MANIFEST_RECORD_V1_SCHEMA,
  type BlockManifestRecord,
} from './generated/block-manifest-record.v1.js';
import { PARSE_INSPECT_V1_SCHEMA, type ParseInspectResult } from './generated/parse-inspect.v1.js';
import { PARSE_PAGES_V1_SCHEMA, type ParsePagesResult } from './generated/parse-pages.v1.js';

/**
 * Validates data produced by the Python document-parser before anything trusts it.
 * A violation is a permanent failure: retrying would produce the same bad output.
 */
export class ParserContracts {
  private readonly validateInspectResult: ValidateFunction<ParseInspectResult>;
  private readonly validatePagesResult: ValidateFunction<ParsePagesResult>;
  private readonly validateManifestRecord: ValidateFunction<BlockManifestRecord>;

  constructor() {
    const ajv = createContractValidator();
    ajv
      .addSchema(PARSE_INSPECT_V1_SCHEMA)
      .addSchema(PARSE_PAGES_V1_SCHEMA)
      .addSchema(BLOCK_MANIFEST_RECORD_V1_SCHEMA);
    this.validateInspectResult = compiled(
      ajv.getSchema(`${PARSE_INSPECT_V1_SCHEMA.$id}#/$defs/ParseInspectResult`),
    );
    this.validatePagesResult = compiled(
      ajv.getSchema(`${PARSE_PAGES_V1_SCHEMA.$id}#/$defs/ParsePagesResult`),
    );
    this.validateManifestRecord = compiled(ajv.getSchema(BLOCK_MANIFEST_RECORD_V1_SCHEMA.$id));
  }

  parseInspectResult(value: unknown): ParseInspectResult {
    return assertValid(this.validateInspectResult, value, 'parse.inspect result');
  }

  parsePagesResult(value: unknown): ParsePagesResult {
    return assertValid(this.validatePagesResult, value, 'parse.pages result');
  }

  parseManifestRecord(value: unknown, lineNumber: number): BlockManifestRecord {
    return assertValid(this.validateManifestRecord, value, `manifest line ${lineNumber}`);
  }
}

function compiled<Value>(validate: ValidateFunction | undefined): ValidateFunction<Value> {
  if (validate === undefined) throw new Error('Contract schema not registered');
  return validate as ValidateFunction<Value>;
}

function assertValid<Value>(validate: ValidateFunction<Value>, value: unknown, subject: string): Value {
  if (validate(value)) return value;
  const firstErrors = (validate.errors ?? [])
    .slice(0, 3)
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
  throw new PermanentJobError('contract_violation', `${subject} violates the contract: ${firstErrors}`);
}
