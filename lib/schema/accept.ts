import { z } from "zod";

import { Follow } from "./follow";

export const Accept = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal("Accept"),
  object: Follow,
});

export type Accept = z.infer<typeof Accept>;
