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

  const packageMap: Record<string, string> = {
    "darwin-arm64": "@ashbyhq/libpg-query-native-darwin-arm64",
    "darwin-x64": "@ashbyhq/libpg-query-native-darwin-x64",
    "linux-x64": "@ashbyhq/libpg-query-native-linux-x64",
    "linux-arm64": "@ashbyhq/libpg-query-native-linux-arm64",
    "linux-x64-musl": "@ashbyhq/libpg-query-native-linux-x64-musl",
    "linux-arm64-musl": "@ashbyhq/libpg-query-native-linux-arm64-musl",
  };

  const pkg = packageMap[platformKey];
  if (!pkg) {
    throw new Error(
      `Unsupported platform: ${platformKey}. ` +
        `Supported: ${Object.keys(packageMap).join(", ")}`
    );
  }

  try {
    return require(pkg);
  } catch {
    throw new Error(
      `Native addon not found for ${platformKey}. Install ${pkg} or ensure it's in your dependencies.`
    );
  }
}

function isMusl(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const { execSync } = require("child_process");
    const ldd = execSync("ldd --version 2>&1", { encoding: "utf8" });
    return ldd.includes("musl");
  } catch {
    // ldd --version exits non-zero on musl
    return true;
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
