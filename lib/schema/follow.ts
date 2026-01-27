import { z } from "zod";

export const ENTITY_TYPE_FOLLOW = "Follow";
export const Follow = z.object({
  id: z.string(),
  type: z.literal(ENTITY_TYPE_FOLLOW),
  actor: z.string(),
  object: z.string(),
});

export type Follow = z.infer<typeof Follow>;
