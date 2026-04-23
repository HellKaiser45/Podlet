import type { App } from 'gateway'
import {
  treaty
} from '@elysiajs/eden'


export const appbase = (baseUrl: string) => {
  return treaty<App>(baseUrl);
};

export type Tappbase = ReturnType<typeof appbase>;
