import type { App } from '@podlet/gateway'
import {
  treaty
} from '@elysiajs/eden'


export const appbase = (baseUrl: string) => {
  return treaty<App>(baseUrl);
};
