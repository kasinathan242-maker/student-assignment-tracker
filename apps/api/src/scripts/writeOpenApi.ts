/* eslint-disable no-console */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

// Building the document only registers routes; it never connects to a database.
process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/openapi-generation';
process.env.NODE_ENV ??= 'development';

const { createApp } = await import('../app');
const { buildOpenApiDocument } = await import('../openapi/document');
createApp();
const out = path.resolve(process.cwd(), '../../docs/openapi.json');
writeFileSync(out, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`OpenAPI document written to ${out}`);
