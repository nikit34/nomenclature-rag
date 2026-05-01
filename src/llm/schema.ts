import { z } from 'zod';

export const ANSWER_SCHEMA = z.object({
  summary: z.string().min(1).max(1500),
  products: z
    .array(
      z.object({
        offerId: z.number().int().nonnegative(),
        explanation: z.string().min(1).max(400),
      }),
    )
    .max(5)
    .default([]),
  clarifying_question: z.string().max(400).optional(),
  clarifying_options: z.array(z.string().min(1).max(80)).max(5).optional(),
  insufficient_data: z.boolean().default(false),
});

export type RawAnswer = z.infer<typeof ANSWER_SCHEMA>;

export const ANSWER_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'Краткий вывод (1-3 предложения) на основе ТОЛЬКО найденных товаров. Если данных нет, явно скажи об этом.',
    },
    products: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          offerId: {
            type: 'number',
            description: 'offerId товара СТРОГО из контекста ниже. Не выдумывай.',
          },
          explanation: {
            type: 'string',
            description: 'Почему именно этот товар подходит под запрос (1-2 предложения).',
          },
        },
        required: ['offerId', 'explanation'],
      },
    },
    clarifying_question: {
      type: 'string',
      description:
        'Если запрос неоднозначен (или пуст результат) - уточняющий вопрос. Иначе пропусти.',
    },
    clarifying_options: {
      type: 'array',
      maxItems: 5,
      items: { type: 'string', maxLength: 80 },
      description:
        'Если задан clarifying_question - 2-4 коротких варианта ответа (например: ["в Москве", "в СПб", "из наличия"]). Будут показаны юзеру кнопками и дописываться к запросу при клике.',
    },
    insufficient_data: {
      type: 'boolean',
      description:
        'true, если в контексте нет ни одного релевантного товара под запрос. В этом случае products=[].',
    },
  },
  required: ['summary', 'insufficient_data'],
} as const;
