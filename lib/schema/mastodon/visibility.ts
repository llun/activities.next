// This schema is base on https://docs.joinmastodon.org/entities/Status/#visibility
import { z } from "zod";

export const Visibility = z.enum(["public", "unlisted", "private", "direct"]);
export type Visibility = z.infer<typeof Visibility>;
