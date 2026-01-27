// This schema is base on https://docs.joinmastodon.org/entities/Poll/#Option
import { z } from "zod";

export const Option = z.object({
  title: z.string().describe("The text value of the poll option"),
  votes_count: z
    .number()
    .describe(
      "The number of votes the poll option has or null if the results are not published yet"
    )
    .nullable(),
});
export type Option = z.infer<typeof Option>;
