import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

/** The OpenAPI schema type @nestjs/swagger expects (not exported from its package root). */
type SchemaObject = Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>['schema'];

/** OpenAPI schema generated from the same zod schema that validates the request. */
export function toOpenApiSchema(schema: z.ZodType, io: 'input' | 'output' = 'input'): SchemaObject {
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema, { io, unrepresentable: 'any' }) };
  // OpenAPI 3.0 does not understand the JSON Schema dialect marker.
  delete jsonSchema.$schema;
  return jsonSchema;
}

export function ApiJsonBody(schema: z.ZodType): MethodDecorator {
  return ApiBody({ schema: toOpenApiSchema(schema) });
}

const DEFAULT_DESCRIPTIONS = { 200: 'Success', 201: 'Created', 202: 'Accepted' } as const;

export interface JsonResponseOptions {
  /** Must match the handler's `@HttpCode` (POST without one answers 201). */
  readonly status?: keyof typeof DEFAULT_DESCRIPTIONS;
  readonly description?: string;
}

export function ApiJsonResponse(schema: z.ZodType, options: JsonResponseOptions = {}): MethodDecorator {
  const status = options.status ?? 200;
  return ApiResponse({
    status,
    description: options.description ?? DEFAULT_DESCRIPTIONS[status],
    schema: toOpenApiSchema(schema, 'output'),
  });
}

/** Documents every property of a zod object schema as a query parameter. */
export function ApiQueryParameters(schema: z.ZodObject): MethodDecorator {
  const decorators = Object.entries(schema.shape).map(([name, propertySchema]) =>
    ApiQuery({
      name,
      required: !(propertySchema as z.ZodType).safeParse(undefined).success,
      schema: toOpenApiSchema(propertySchema as z.ZodType),
    }),
  );
  return applyDecorators(...decorators);
}
