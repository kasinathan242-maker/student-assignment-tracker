import { z, type ZodType } from 'zod';
import { env } from '../config/env';
import { registry, type RegisteredRoute } from '../lib/route';

type JsonSchema = Record<string, unknown>;

function toJsonSchema(schema: ZodType, io: 'input' | 'output' = 'input'): JsonSchema {
  try {
    const json = z.toJSONSchema(schema, { io, unrepresentable: 'any', target: 'openapi-3.0' }) as JsonSchema;
    delete json.$schema;
    return json;
  } catch {
    return { type: 'object' };
  }
}

function parameters(def: RegisteredRoute): unknown[] {
  const out: unknown[] = [];
  const add = (schema: ZodType | undefined, where: 'path' | 'query') => {
    if (!schema) return;
    const json = toJsonSchema(schema);
    const props = (json.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((json.required as string[] | undefined) ?? []);
    for (const [name, prop] of Object.entries(props)) {
      out.push({ name, in: where, required: where === 'path' || required.has(name), schema: prop });
    }
  };
  add(def.params, 'path');
  add(def.query, 'query');
  return out;
}

const ERROR_SCHEMA = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', description: 'Stable machine-readable error code' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        fields: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
};

/** Builds the OpenAPI 3.0 document from the route registry (populated when the app is created). */
export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const def of registry) {
    const path = `/api/v1${def.path.replace(/:([A-Za-z]+)/g, '{$1}')}`;
    const security = def.access === 'public' ? [] : [{ cookieAuth: [] }];
    const access =
      def.access === 'org'
        ? `Requires an active membership in the organization${def.orgRoles ? ` with role: ${def.orgRoles.join(', ')}` : ''}.`
        : def.access === 'platform'
          ? 'Requires the platform administrator role.'
          : def.access === 'user'
            ? 'Requires a signed-in user.'
            : 'Public.';
    const op: Record<string, unknown> = {
      summary: def.summary,
      description: [
        def.description,
        access,
        def.method !== 'get' ? 'State-changing: send the `x-csrf-token` header.' : null,
      ]
        .filter(Boolean)
        .join('\n\n'),
      tags: def.tags,
      security,
      parameters: parameters(def),
      responses: {
        [String(def.status)]: {
          description: 'Success',
          ...(def.status === 204
            ? {}
            : {
                content: { [def.responseContentType ?? 'application/json']: { schema: { type: 'object' } } },
              }),
        },
        '400': {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ...(def.access !== 'public'
          ? {
              '401': {
                description: 'Not signed in or session expired',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
              },
            }
          : {}),
        '403': {
          description: 'Forbidden (including CSRF failures)',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '404': {
          description: 'Not found or not accessible',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        '429': {
          description: 'Rate limited',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    };
    if (def.body) {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: toJsonSchema(def.body) } },
      };
    } else if (def.requestContentType === 'multipart/form-data') {
      op.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: { file: { type: 'string', format: 'binary' } },
              required: ['file'],
            },
          },
        },
      };
    }
    (paths[path] ??= {})[def.method] = op;
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Student Assignment Tracker API',
      version: env().APP_VERSION,
      description:
        'Versioned REST API. Authentication uses HttpOnly cookies (short-lived access token + rotating refresh token). ' +
        'All state-changing requests require the `x-csrf-token` header (obtain via GET /api/v1/auth/csrf or GET /api/v1/me). ' +
        'Errors use the `Error` envelope. Lists use `page`/`pageSize` pagination and return `{ items, page, pageSize, total, totalPages }`.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sat_at' } },
      schemas: { Error: ERROR_SCHEMA },
    },
    paths,
  };
}
