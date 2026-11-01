import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { parseRequest } from './parse-request.js';

/** Nest pipe form of {@link parseRequest}: `@Body(new ZodValidationPipe(schema))`. */
@Injectable()
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform<unknown, z.infer<Schema>> {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.infer<Schema> {
    return parseRequest(this.schema, value);
  }
}
