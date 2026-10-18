// Interfaces for the Graal/Java APIs used by the Karate configuration.
interface JavaBytes { readonly length: number; readonly [index: number]: number }
interface JavaString { toString(): string; getBytes(encoding: string): JavaBytes }
interface JdbcResultSet {
  next(): boolean;
  getString(column: number): string | null;
  getMetaData(): { getColumnCount(): number; getColumnName(column: number): string };
  close(): void;
}
interface JdbcStatement { executeQuery(sql: string): JdbcResultSet; execute(sql: string): boolean; close(): void }
interface JavaMac { init(key: unknown): void; doFinal(bytes: JavaBytes): JavaBytes }
interface JavaClasses {
  'java.sql.DriverManager': { getConnection(url: string, user: string, password: string): { createStatement(): JdbcStatement; close(): void } };
  'java.util.Base64': { getUrlEncoder(): { withoutPadding(): { encodeToString(bytes: JavaBytes): string } } };
  'javax.crypto.Mac': { getInstance(algorithm: string): JavaMac };
  'javax.crypto.spec.SecretKeySpec': new (bytes: JavaBytes, algorithm: string) => unknown;
}
declare const Java: { type<K extends keyof JavaClasses>(name: K): JavaClasses[K] };
declare const java: { lang: { String: new (value: string | JavaString | JavaBytes) => JavaString; System: { getenv(name: string): string | null } } };
declare const karate: {
  properties: Record<string, string | undefined>;
  log(...values: unknown[]): void;
  configure(name: string, value: boolean | (() => Record<string, string>)): void;
};
