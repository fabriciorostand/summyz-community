import { accessMessages } from "./access";
import { commonMessages } from "./common";
import { configurationMessages } from "./configuration";
import { meetingsMessages } from "./meetings";
import { profilesMessages } from "./profiles";

export const ptBR = {
  ...commonMessages,
  ...accessMessages,
  ...meetingsMessages,
  ...configurationMessages,
  ...profilesMessages,
};

export type Messages = typeof ptBR;
