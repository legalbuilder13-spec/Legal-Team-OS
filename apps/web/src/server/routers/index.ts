import { router } from '../trpc.js';
import { mattersRouter } from './matters.js';
import { dashboardRouter } from './dashboard.js';
import { adminRouter } from './admin.js';

export const appRouter = router({
  matters: mattersRouter,
  dashboard: dashboardRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
