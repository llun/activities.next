import { z } from "zod";

export const PropertyValue = z.object({
  type: z.literal("PropertyValue"),
  name: z.string(),
  value: z.string(),
});

export type PropertyValue = z.infer<typeof PropertyValue>;
