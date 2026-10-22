export interface DatabaseMigration {
  sql: string;
  version: number;
}
