import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../observability/logger.js';
import { ANSWER_SCHEMA, ANSWER_TOOL_INPUT_SCHEMA, type RawAnswer } from './schema.js';
import { SYSTEM_PROMPT } from './prompt.js';

const client = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
  maxRetries: 3,
  timeout: 30_000,
});

const TOOL_NAME = 'return_answer';

export type LLMUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type LLMResult = {
  answer: RawAnswer;
  usage: LLMUsage;
};

export async function generateAnswer(
  userMessage: string,
  signal?: AbortSignal,
): Promise<LLMResult> {
  const t0 = Date.now();
  const response = await client.messages.create(
    {
      model: config.LLM_MODEL,
      max_tokens: 1024,
      temperature: 0,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Финальный ответ консультанта в структурированном виде.',
          input_schema: ANSWER_TOOL_INPUT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: userMessage }],
    },
    signal ? { signal } : undefined,
  );

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('LLM did not return tool_use block');
  }
  const parsed = ANSWER_SCHEMA.parse(toolUse.input);
  const usage: LLMUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? undefined,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? undefined,
  };
  logger.info({ ms: Date.now() - t0, usage, model: config.LLM_MODEL }, 'llm response');
  return { answer: parsed, usage };
}
