import { Context, Effect, Layer } from 'effect';
import { RuntimeContext } from '#src/context';
import { MessageService } from '#src/services/message.service';

/** What the server needs from any chat bridge it relays riders' chat to. */
export interface Bridge {
  send(content: string, sender?: string): void;
  online(id: bigint, joining: boolean): void;
  close(): Promise<void>;
}

export interface ChatTransport {
  deliver(content: string, sender: string): Promise<void>;
  presence(count: number): void;
  close(): Promise<void>;
}

export interface ChatSettings {
  readonly helpMessage: string;
  readonly announcePlayers: boolean;
}

const make = Effect.gen(function* () {
  const context = yield* RuntimeContext;
  const messages = yield* MessageService;

  /** A chat connection. All external work is bounded and detached from the ride tick. */
  const open = Effect.fn('ChatService.open')(function* (
    transport: ChatTransport,
    name: string,
    settings: () => ChatSettings,
  ) {
    // Open admits at most 100 sends; close permanently stops admission. Each settled send releases one slot.
    let pending = 0;
    let stopped = false;

    const send = (content: string, sender = 'Server') => {
      if (stopped || pending >= 100) return;
      pending++;
      void transport
        .deliver(content, sender)
        .catch(() => {
          context.world.lifecycle.log.warn(`${name.toLowerCase()}.delivery_failed`, `${name} delivery failed`);
        })
        .finally(() => {
          pending--;
        });
    };

    return {
      get closed() {
        return stopped;
      },

      /** Answers bridge commands and relays anything else to riders in-game. */
      relay(author: string, content: string) {
        const current = settings();

        if (content === '!online') send(`${context.world.online.size} riders online`);
        else if (content === '!ping') send('pong');
        else if (content === '!help' && current.helpMessage) send(current.helpMessage);
        else if (!content.startsWith('!'))
          Effect.runSync(messages.sendMessage(content.slice(0, 2000), undefined, author));
      },

      send,

      online: (id: bigint, joining: boolean) => {
        transport.presence(context.world.online.size);

        if (!settings().announcePlayers) return;
        const profile = context.profiles.get(Number(id));
        send(joining ? 'Riding' : 'Leaving', `${profile.firstName} ${profile.lastName}`);
      },

      close: async () => {
        stopped = true;
        await transport.close();
      },
    };
  });

  return { open };
});

/** The behavior every chat bridge shares: commands, bounded delivery and presence. */
export class ChatService extends Context.Service<ChatService, Effect.Success<typeof make>>()('zluggish/ChatService') {
  static readonly layer = Layer.effect(ChatService, make);
}
