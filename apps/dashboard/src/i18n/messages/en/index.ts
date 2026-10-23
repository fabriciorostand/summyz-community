import type { Messages } from "../pt-BR";
import { accessMessages } from "./access";
import { commonMessages } from "./common";
import { configurationMessages } from "./configuration";
import { meetingsMessages } from "./meetings";
import { profilesMessages } from "./profiles";

export const en: Messages = {
  ...commonMessages,
  ...accessMessages,
  ...meetingsMessages,
  ...configurationMessages,
  ...profilesMessages,
};
