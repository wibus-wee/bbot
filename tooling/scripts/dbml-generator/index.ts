import { join } from 'node:path';

import { pgGenerate } from 'drizzle-dbml-generator';

import * as schema from '../../../packages/database/schemas';

const out = join(__dirname, '../../../docs/dev/database-schema.dbml');
const relational = true;

pgGenerate({ out, relational, schema });

console.log('🏁 dbml generated successful!');
