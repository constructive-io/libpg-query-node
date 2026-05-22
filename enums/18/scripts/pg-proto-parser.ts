import { PgProtoParser, PgProtoParserOptions } from 'pg-proto-parser';
import { resolve, join } from 'path';

const inFile: string = join(__dirname, '../../../protos/18/pg_query.proto');
const outDir: string = resolve(join(__dirname, '../src'));

const options: PgProtoParserOptions = {
  outDir,
  enums: {
    enabled: true,
    enumsAsTypeUnion: false,
    filename: 'index.ts'
  }
};
const parser = new PgProtoParser(inFile, options);

parser.write();