import { query, SqliteExecutor } from '#src/db/query';
import { immediate } from '#src/db/transaction';
import type { Database } from '#src/db/schema';
import type { Updateable } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseSync } from 'node:sqlite';

import type { JsonValue } from '#src/dtos/management.dto';

export class ManagementRepository {
  private readonly executor: SqliteExecutor;

  constructor(private readonly db: DatabaseSync) {
    this.executor = new SqliteExecutor(db);
  }

  transaction<T>(operation: () => T) {
    return immediate(this.db, operation);
  }

  complete() {
    return (
      this.executor.get(query.selectFrom('web_setup_state').select('state').where('id', '=', 1))?.state === 'complete'
    );
  }

  finish() {
    this.executor.run(query.updateTable('web_setup_state').set({ state: 'complete' }).where('id', '=', 1));
  }

  administrators() {
    return this.executor.all(
      query.selectFrom('user').select('player_id').where('role', '=', 'administrator').where('enabled', '=', 1),
    ).length;
  }

  update(id: number, values: Updateable<Database['user']>, revoke = true) {
    this.executor.run(
      query
        .updateTable('user')
        .set({ ...values, revision: sql`revision + 1`, ...(revoke && { auth_version: sql`auth_version + 1` }) })
        .where('player_id', '=', id),
    );

    if (revoke) {
      this.executor.run(
        query
          .deleteFrom('rider_document')
          .where('player_id', '=', id)
          .where('name', 'in', ['encryption_key.bin', 'relay-auth-version']),
      );
    }
  }

  operation(actor: number, id: string) {
    return this.executor.get(
      query
        .selectFrom('management_operation')
        .selectAll()
        .where('actor_player_id', '=', actor)
        .where('operation_id', '=', id),
    );
  }

  record(actor: number, id: string, action: string, target: number, fingerprint: string, result: JsonValue) {
    this.executor.run(
      query.insertInto('management_operation').values({
        actor_player_id: actor,
        operation_id: id,
        action,
        target: String(target),
        fingerprint,
        status: 'complete',
        result: JSON.stringify(result),
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
    );
  }

  intent(actor: number, operation: string, action: string, fingerprint: string) {
    this.executor.run(
      query.insertInto('management_operation').values({
        actor_player_id: actor,
        operation_id: operation,
        action,
        target: 'server',
        fingerprint,
        status: 'unknown',
        result: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      }),
    );
  }

  finishOperation(actor: number, operation: string, result: JsonValue) {
    this.executor.run(
      query
        .updateTable('management_operation')
        .set({ status: 'complete', result: JSON.stringify(result), updated_at: Date.now() })
        .where('actor_player_id', '=', actor)
        .where('operation_id', '=', operation),
    );
  }
}
