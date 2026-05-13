import { router } from '../trpc';
import { mattersRouter } from './matters';
import { dashboardRouter } from './dashboard';
import { adminRouter } from './admin';
import { counterpartiesRouter } from './counterparties';
import { chatRouter } from './chat';
import { notionRouter } from './notion';

export const appRouter = router({
  matters: mattersRouter,
  dashboard: dashboardRouter,
  admin: adminRouter,
  counterparties: counterpartiesRouter,
  chat: chatRouter,
  notion: notionRouter,
});

export type AppRouter = typeof appRouter;
