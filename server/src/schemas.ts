import { z } from 'zod';
import {
  MAX_SELECTION_RANGES,
  NAME_REGEX,
  ROOM_ID_REGEX,
  isLanguageId,
  type ClientMessage,
  type LanguageId,
} from '@collab/shared';

const revision = z.number().int().nonnegative();
// Offsets are only range-checked against the real document later (see Room.handleSelection).
const offset = z.number().int().nonnegative();

const selection = z.object({
  ranges: z
    .array(z.object({ anchor: offset, head: offset }))
    .min(1)
    .max(MAX_SELECTION_RANGES),
});

const opComponent = z.union([
  z
    .number()
    .int()
    .refine((n) => n !== 0),
  z.string().min(1),
]);

const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    roomId: z.string().regex(ROOM_ID_REGEX),
    name: z.string().trim().regex(NAME_REGEX),
  }),
  z.object({
    type: z.literal('op'),
    revision,
    ops: z.array(opComponent).max(10_000),
  }),
  z.object({
    type: z.literal('selection'),
    revision,
    selection: selection.nullable(),
  }),
  z.object({
    type: z.literal('set-language'),
    language: z.custom<LanguageId>(isLanguageId),
  }),
]);

// Compile-time check: the schema must never accept a shape ClientMessage doesn't describe.
type Inferred = z.infer<typeof clientMessageSchema>;
const _assignable = (m: Inferred): ClientMessage => m;
void _assignable;

export function parseClientMessage(raw: string): ClientMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = clientMessageSchema.safeParse(json);
  return result.success ? result.data : null;
}
