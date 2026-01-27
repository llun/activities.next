import { z } from "zod";

import { Follow } from "./follow";
import { Like } from "./like";

export const Undo = z.object({
  id: z.string(),
  actor: z.string(),
  type: z.literal("Undo"),
  object: z.union([Like, Follow]),
});

export type Undo = z.infer<typeof Undo>;
