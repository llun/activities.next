import { z } from "zod";

export const Mention = z.object({
  type: z.literal("Mention"),
  href: z.string(),
  name: z.string(),
});

export type Mention = z.infer<typeof Mention>;
