import { router } from '../trpc';
import { mattersRouter } from './matters';
import { dashboardRouter } from './dashboard';
import { adminRouter } from './admin';
import { counterpartiesRouter } from './counterparties';

export const appRouter = router({
  matters: mattersRouter,
  dashboard: dashboardRouter,
  admin: adminRouter,
  counterparties: counterpartiesRouter,
});

export type AppRouter = typeof appRouter;
