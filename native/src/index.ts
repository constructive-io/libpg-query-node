import type { ParseResult } from "@pgsql/types";

export type { ParseResult } from "@pgsql/types";

export interface ScanToken {
  start: number;
  end: number;
  text: string;
  tokenType: number;
  tokenName: string;
  keywordKind: number;
  keywordName: string;
}

export interface ScanResult {
  version: number;
  tokens: ScanToken[];
}

export interface SqlErrorDetails {
  message: string;
  cursorPosition: number;
  fileName?: string;
  functionName?: string;
  lineNumber?: number;
  context?: string;
}

export class SqlError extends Error {
  sqlDetails?: SqlErrorDetails;

  constructor(message: string, details?: SqlErrorDetails) {
    super(message);
    this.name = "SqlError";
    this.sqlDetails = details;
  }
}

export function hasSqlDetails(error: unknown): error is SqlError {
  return error instanceof SqlError && error.sqlDetails !== undefined;
}

function loadNativeAddon(): NativeAddon {
  const platform = process.platform;
  const arch = process.arch;
  const musl = isMusl();

  const platformKey = musl ? `${platform}-${arch}-musl` : `${platform}-${arch}`;

  // Try loading from a local prebuild first (development / monorepo)
  const path = require("path");
  const localPrebuild = path.join(
    __dirname,
    "..",
    "prebuilds",
    platformKey,
    "libpg_query_native.node"
  );
  try {
    return require(localPrebuild);
  } catch {
    // fall through to platform package
  }

  const platforms: Record<string, unknown> = require("../platforms.json");
  const pkgName = `@ashbyhq/libpg-query-native-${platformKey}`;

  if (!platforms[platformKey]) {
    throw new Error(
      `Unsupported platform: ${platformKey}. ` +
        `Supported: ${Object.keys(platforms).join(", ")}`
    );
  }

  try {
    return require(pkgName);
  } catch {
    throw new Error(
      `Native addon not found for ${platformKey}. Install ${pkgName} or ensure it's in your dependencies.`
    );
  }
}

function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  // Prefer Node's own libc marker: `glibcVersionRuntime` is set on glibc and
  // absent on musl. This is reliable in minimal images (distroless/scratch)
  // that ship no `ldd` binary — shelling out there throws and would otherwise
  // be misread as musl, selecting the wrong platform package.
  try {
    const report = process.report?.getReport?.() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    if (report?.header != null) {
      return report.header.glibcVersionRuntime == null;
    }
  } catch {
    // fall through to the filesystem probe
  }
  // Fallback (older runtimes without process.report): look for the musl
  // dynamic loader on disk. Default to glibc — the common case — when unsure.
  try {
    const fs = require("fs");
    return fs.readdirSync("/lib").some((f: string) => f.startsWith("ld-musl-"));
  } catch {
    return false;
  }
}

interface NativeResult<T = string> {
  error: string | null;
  result: T | null;
}

interface NativeAddon {
  parseSync(query: string): NativeResult;
  parsePlPgSQLSync(query: string): NativeResult;
  fingerprintSync(query: string): NativeResult;
  normalizeSync(query: string): NativeResult;
  scanSync(query: string): NativeResult<ScanResult>;
}

const addon = loadNativeAddon();

function checkError(res: NativeResult<any>): void {
  if (res.error) {
    const details: SqlErrorDetails = JSON.parse(res.error);
    throw new SqlError(details.message, details);
  }
}

export function parseSync(query: string): ParseResult {
  const res = addon.parseSync(query);
  checkError(res);
  return JSON.parse(res.result as string);
}

export async function parse(query: string): Promise<ParseResult> {
  return parseSync(query);
}

export function parsePlPgSQLSync(query: string): any {
  const res = addon.parsePlPgSQLSync(query);
  checkError(res);
  return JSON.parse(res.result as string);
}

export async function parsePlPgSQL(query: string): Promise<any> {
  return parsePlPgSQLSync(query);
}

export function fingerprintSync(query: string): string {
  const res = addon.fingerprintSync(query);
  checkError(res);
  return res.result as string;
}

export async function fingerprint(query: string): Promise<string> {
  return fingerprintSync(query);
}

export function normalizeSync(query: string): string {
  const res = addon.normalizeSync(query);
  checkError(res);
  return res.result as string;
}

export async function normalize(query: string): Promise<string> {
  return normalizeSync(query);
}

export function scanSync(query: string): ScanResult {
  const res = addon.scanSync(query);
  checkError(res);
  return res.result as ScanResult;
}

export async function scan(query: string): Promise<ScanResult> {
  return scanSync(query);
}

export async function loadModule(): Promise<void> {
  // no-op for native — module is loaded synchronously via require()
}
