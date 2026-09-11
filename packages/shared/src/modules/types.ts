import type { z } from "zod";
import type { ModuleName } from "../constants";
import type { ModuleUi } from "../fields";

export interface ModuleDefinition<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: ModuleName;
  schema: TSchema;
  ui: ModuleUi;
}

/** Every module schema is built so that `schema.parse({})` yields the defaults. */
export const defaultsOf = <T extends z.ZodTypeAny>(schema: T): z.infer<T> =>
  schema.parse({}) as z.infer<T>;
