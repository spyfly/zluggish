import { Context, Effect, Layer } from 'effect';
import { RuntimeContext } from '#src/context';
import type { SocialRepository } from '#src/repositories/social.repository';
import { MessageService } from '#src/services/message.service';

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const repositories = context.accounts.repositories;
  const messageService = yield* MessageService;

  const listUser = Effect.fn('SocialService.listUser')(function* (...values: Parameters<SocialRepository['listUser']>) {
    return repositories.socialRepository.listUser(...values);
  });

  const findActivity = Effect.fn('SocialService.findActivity')(function* (
    ...values: Parameters<SocialRepository['findActivity']>
  ) {
    return repositories.socialRepository.findActivity(...values);
  });

  const insertPlayback = Effect.fn('SocialService.insertPlayback')(function* (
    ...values: Parameters<SocialRepository['insertPlayback']>
  ) {
    return repositories.socialRepository.insertPlayback(...values);
  });

  const playbackForSegment = Effect.fn('SocialService.playbackForSegment')(function* (
    ...values: Parameters<SocialRepository['playbackForSegment']>
  ) {
    return repositories.socialRepository.playbackForSegment(...values);
  });

  const sendMessage = Effect.fn('SocialService.sendMessage')(function* (
    message: string,
    recipients?: bigint[],
    sender: string = 'Server',
  ) {
    return yield* messageService.sendMessage(message, recipients, sender);
  });

  return { listUser, findActivity, insertPlayback, playbackForSegment, sendMessage };
});

export class SocialService extends Context.Service<SocialService, Effect.Success<typeof make>>()(
  'zluggish/SocialService',
) {
  static readonly layer = Layer.effect(SocialService, make);
}
