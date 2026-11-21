import { Context, Effect, Layer } from 'effect';
import { RuntimeContext } from '#src/context';
import type { ProtobufMessage, ProtobufRows, Table } from '#src/repositories/protobuf.repository';
import type { DescMessage } from '@bufbuild/protobuf';

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;

  const insert = Effect.fn('RecordDataService.insert')(function* <Schema extends DescMessage>(
    table: Table,
    schema: Schema,
    message: ProtobufMessage<Schema>,
    exclude: Array<string> = [],
  ) {
    return repositories.protobufRepository.insert(table, schema, message, exclude);
  });

  const update = Effect.fn('RecordDataService.update')(function* <Schema extends DescMessage>(
    table: Table,
    id: bigint,
    schema: Schema,
    message: ProtobufMessage<Schema>,
    exclude: Array<string> = [],
  ) {
    repositories.protobufRepository.update(table, id, schema, message, exclude);
  });

  const select = Effect.fn('RecordDataService.select')(function* <Schema extends DescMessage>(
    table: Table,
    schema: Schema,
    playerId: bigint,
  ) {
    return repositories.protobufRepository.select(table, schema, playerId);
  });

  const decode = Effect.fn('RecordDataService.decode')(function* <Schema extends DescMessage>(
    schema: Schema,
    row: Parameters<ProtobufRows['decode']>[1],
  ) {
    return repositories.protobufRepository.decode(schema, row);
  });

  return { insert, update, select, decode };
});

export class RecordDataService extends Context.Service<RecordDataService, Effect.Success<typeof make>>()(
  'zluggish/RecordDataService',
) {
  static readonly layer = Layer.effect(RecordDataService, make);
}
