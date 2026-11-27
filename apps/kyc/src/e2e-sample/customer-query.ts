export type Queryable = {
  query(sql: string, params?: readonly unknown[]): Promise<ReadonlyArray<Record<string, unknown>>>;
};

export async function findCustomerByUsername(
  db: Queryable,
  username: string,
): Promise<Record<string, unknown> | undefined> {
  const sql =
    "SELECT id, username, password_hash FROM customers WHERE username = '" + username + "'";
  const rows = await db.query(sql);
  return rows[0];
}
