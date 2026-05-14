import { router } from '../trpc';
import { mattersRouter } from './matters';
import { dashboardRouter } from './dashboard';
import { adminRouter } from './admin';
import { counterpartiesRouter } from './counterparties';
import { chatRouter } from './chat';
import { notionRouter } from './notion';
import { driveRouter } from './drive';
import { escalationsRouter } from './escalations';
import { draftsRouter } from './drafts';
import { documentsRouter } from './documents';
import { templatesRouter } from './templates';
import { rulesRouter } from './rules';
import { analysisRouter } from './analysis';
import { toolsRouter } from './tools';
import { domainConfigRouter } from './domain-config';
import { analysisMetricsRouter } from './analysis-metrics';
import { rejectionThemesRouter } from './rejection-themes';

export const appRouter = router({
  matters: mattersRouter,
  dashboard: dashboardRouter,
  admin: adminRouter,
  counterparties: counterpartiesRouter,
  chat: chatRouter,
  notion: notionRouter,
  drive: driveRouter,
  escalations: escalationsRouter,
  drafts: draftsRouter,
  documents: documentsRouter,
  templates: templatesRouter,
  rules: rulesRouter,
  analysis: analysisRouter,
  tools: toolsRouter,
  domainConfig: domainConfigRouter,
  analysisMetrics: analysisMetricsRouter,
  rejectionThemes: rejectionThemesRouter,
});

export type AppRouter = typeof appRouter;
