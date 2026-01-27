import { z } from "zod";
import { Emoji } from "./emoji";
import { Mention } from "./mention";
import { HashTag } from "./hashtag";

export const Tag = z.union([Mention, Emoji, HashTag]);
export type Tag = z.infer<typeof Tag>;
