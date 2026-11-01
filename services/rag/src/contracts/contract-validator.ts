import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

// ajv-formats is CommonJS: Node exposes `module.exports` as the default import and the
// plugin function is also attached as its `default` property, which is what TS types.
const addFormats = addFormatsModule.default;

/**
 * Creates a strict JSON Schema 2020-12 validator with `uuid`, `date-time` and other
 * formats enabled. Used to validate untrusted data crossing a service boundary
 * (job results from the Python parser, manifest lines) against `contracts/`.
 */
export function createContractValidator(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return ajv;
}
