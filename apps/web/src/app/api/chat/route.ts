import { NextResponse } from 'next/server';
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import type Anthropic from '@anthropic-ai/sdk';
import { getDb, chatMessages, matters } from '@legal/db';
import { auth, currentUser } from '@clerk/nextjs/server';
import { users } from '@legal/db';
import { getAnthropic, getAnthropicModel } from '@/server/integrations/anthropic';
import { buildSystemPrompt, loadMatterContext } from '@/server/chat/system-prompt';
import { TOOL_DEFINITIONS, executeTool } from '@/server/chat/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  matterId: z.string().uuid(),
  message: z.string().min(1).max(20_000),
});

type AnthropicMessage = Anthropic.MessageParam;

function toAnthropicMessages(rows: Array<{
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: unknown[] | null;
  toolName: string | null;
  toolUseId: string | null;
}>): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const r of rows) {
    if (r.role === 'user') {
      out.push({ role: 'user', content: r.content });
    } else if (r.role === 'assistant') {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (r.content) blocks.push({ type: 'text', text: r.content });
      for (const tc of (r.toolCalls ?? []) as Array<{ id: string; name: string; input: unknown }>) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input as Record<string, unknown> });
      }
      out.push({ role: 'assistant', content: blocks });
    } else if (r.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: r.toolUseId ?? '', content: r.content },
        ],
      });
    }
  }
  return out;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', issues: parsed.error.issues }, { status: 400 });
  }

  const anthropic = getAnthropic();
  if (!anthropic) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY is not configured on the web app' },
      { status: 503 },
    );
  }

  const db = getDb();
  const dbUser = await db.query.users.findFirst({ where: eq(users.clerkId, session.userId) });
  if (!dbUser) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const matter = await db.query.matters.findFirst({ where: eq(matters.id, parsed.data.matterId) });
  if (!matter) return NextResponse.json({ error: 'matter not found' }, { status: 404 });

  const matterCtx = await loadMatterContext(db, parsed.data.matterId);
  if (!matterCtx) return NextResponse.json({ error: 'matter not found' }, { status: 404 });
  const system = buildSystemPrompt(matterCtx);

  await db.insert(chatMessages).values({
    matterId: parsed.data.matterId,
    authorId: dbUser.id,
    role: 'user',
    content: parsed.data.message,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const toolCtx = {
          db,
          matterId: parsed.data.matterId,
          userId: dbUser.id,
          userName: dbUser.name,
        };

        // Loop until the model is done (no more tool uses), capped at 8 rounds.
        let round = 0;
        const MAX_ROUNDS = 8;

        while (round < MAX_ROUNDS) {
          round += 1;

          const history = await db
            .select({
              role: chatMessages.role,
              content: chatMessages.content,
              toolCalls: chatMessages.toolCalls,
              toolName: chatMessages.toolName,
              toolUseId: chatMessages.toolUseId,
            })
            .from(chatMessages)
            .where(eq(chatMessages.matterId, parsed.data.matterId))
            .orderBy(asc(chatMessages.createdAt));

          const messages = toAnthropicMessages(
            history.map((h) => ({
              role: h.role as 'user' | 'assistant' | 'tool',
              content: h.content,
              toolCalls: (h.toolCalls as unknown[]) ?? [],
              toolName: h.toolName,
              toolUseId: h.toolUseId,
            })),
          );

          let text = '';
          const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
          let stopReason: string | null = null;

          await new Promise<void>((resolve, reject) => {
            const ms = anthropic.messages.stream({
              model: getAnthropicModel(),
              max_tokens: 2048,
              system: [
                {
                  type: 'text',
                  text: system,
                  cache_control: { type: 'ephemeral' },
                },
              ],
              tools: TOOL_DEFINITIONS,
              messages,
            });

            ms.on('text', (delta) => {
              text += delta;
              send('text', { delta });
            });

            ms.on('contentBlock', (block) => {
              if (block.type === 'tool_use') {
                toolUses.push({
                  id: block.id,
                  name: block.name,
                  input: (block.input as Record<string, unknown>) ?? {},
                });
                send('tool_use', { id: block.id, name: block.name, input: block.input });
              }
            });

            ms.on('message', (msg) => {
              stopReason = msg.stop_reason;
            });

            ms.on('error', (e) => reject(e));
            ms.on('end', () => resolve());
          });

          await db.insert(chatMessages).values({
            matterId: parsed.data.matterId,
            authorId: null,
            role: 'assistant',
            content: text,
            toolCalls: toolUses,
          });

          if (stopReason !== 'tool_use' || toolUses.length === 0) {
            send('done', { stopReason });
            break;
          }

          // Execute every requested tool and post results back.
          for (const tu of toolUses) {
            const result = await executeTool(tu.name, tu.input, toolCtx);
            send('tool_result', { id: tu.id, name: tu.name, result });
            await db.insert(chatMessages).values({
              matterId: parsed.data.matterId,
              authorId: null,
              role: 'tool',
              content: result,
              toolName: tu.name,
              toolUseId: tu.id,
            });
          }
        }

        controller.close();
      } catch (e) {
        send('error', { message: (e as Error).message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
