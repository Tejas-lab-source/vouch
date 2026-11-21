// @ts-check
import { CreateNoteInput, CreateNoteOutput } from '../../contract.js';

/**
 * HTTP adapter: POST /example/notes → createNote. Thin: parse, call the use case, map.
 * @param {{ createNote: (input: unknown, ctx: import('../../../../platform/use-case.js').CallContext) => Promise<{ noteId: string }> }} api
 */
export function exampleRoutes(api) {
  /** @param {import('fastify').FastifyInstance} app */
  return async (app) => {
    app.post(
      '/example/notes',
      {
        config: { auth: 'public' },
        schema: { body: CreateNoteInput, response: { 201: CreateNoteOutput } },
      },
      async (request, reply) => {
        const key = request.headers['idempotency-key'];
        const result = await api.createNote(request.body, {
          actor: null,
          idempotencyKey: typeof key === 'string' ? key : undefined,
        });
        reply.code(201);
        return result;
      },
    );
  };
}
