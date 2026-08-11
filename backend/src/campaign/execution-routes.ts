import {
  campaignExecutionByReference,
  cancelCampaignExecution,
  executePreparedCampaign,
  listCampaignDeliveries,
  listCampaignExecutions,
  resumeCampaignExecution,
} from './executions';

const KNOWN_ERROR = /^(?:CAMPAIGN|LINE)_[A-Z0-9_]+$/;

function fail(c: any, error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';
  const code = raw === 'FORBIDDEN_ROLE' ? 'FORBIDDEN' : KNOWN_ERROR.test(raw) ? raw : fallback;
  const status = code === 'FORBIDDEN' ? 403 : code.endsWith('_NOT_FOUND') ? 404 :
    code.includes('CREDENTIAL_MISSING') || code.endsWith('_ALREADY_EXISTS') || code.endsWith('_CANCELLED')
      || code.endsWith('_COMPLETED') || code.endsWith('_REQUIRES_PREPARED') || code.endsWith('_TOO_LARGE') ? 409 : 400;
  return c.json({ success: false, error: code }, status);
}

const references = (c: any, deps: any) => ({
  workspaceId: deps.workspaceIdOf(c),
  safeCampaignReference: deps.text(c.req.param('safeCampaignReference'), 100),
  safeExecutionReference: deps.text(c.req.param('safeExecutionReference'), 100),
});

export function registerCampaignExecutionRoutes(app: any, deps: any) {
  app.post('/api/campaigns/:safeCampaignReference/execute', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const body: any = await c.req.json().catch(() => ({}));
      if (Object.keys(body).some(key => key !== 'actionReference')) throw new Error('CAMPAIGN_EXECUTION_INPUT_INVALID');
      const execution = await executePreparedCampaign(c.env.smart_menu_db, {
        workspaceId: deps.workspaceIdOf(c),
        safeCampaignReference: deps.text(c.req.param('safeCampaignReference'), 100),
        actionReference: body.actionReference,
        userId: deps.text(c.get('userId')) || null,
        signingSecret: String(c.env.MEMBER_IDENTITY_HMAC_SECRET || ''),
        trackingBaseUrl: new URL(c.req.url).origin,
      });
      return c.json({ success: true, execution }, execution.idempotent ? 200 : 201);
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_EXECUTION_FAILED');
    }
  });

  app.get('/api/campaigns/:safeCampaignReference/executions', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const executions = await listCampaignExecutions(
        c.env.smart_menu_db,
        deps.workspaceIdOf(c),
        deps.text(c.req.param('safeCampaignReference'), 100),
      );
      return c.json({ success: true, executions });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_EXECUTION_LIST_FAILED');
    }
  });

  app.get('/api/campaigns/:safeCampaignReference/executions/:safeExecutionReference', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const execution = await campaignExecutionByReference(c.env.smart_menu_db, references(c, deps));
      return c.json({ success: true, execution });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_EXECUTION_READ_FAILED');
    }
  });

  app.get('/api/campaigns/:safeCampaignReference/executions/:safeExecutionReference/deliveries', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const requestedLimit = Number(c.req.query('limit') || 25);
      const requestedOffset = Number(c.req.query('offset') || 0);
      const result = await listCampaignDeliveries(c.env.smart_menu_db, {
        ...references(c, deps),
        limit: Number.isFinite(requestedLimit) ? requestedLimit : 25,
        offset: Number.isFinite(requestedOffset) ? requestedOffset : 0,
      });
      return c.json({ success: true, ...result });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_DELIVERY_LIST_FAILED');
    }
  });

  app.post('/api/campaigns/:safeCampaignReference/executions/:safeExecutionReference/resume', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const execution = await resumeCampaignExecution(c.env.smart_menu_db, {
        ...references(c, deps), signingSecret: String(c.env.MEMBER_IDENTITY_HMAC_SECRET || ''),
      });
      return c.json({ success: true, execution });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_EXECUTION_RESUME_FAILED');
    }
  });

  app.post('/api/campaigns/:safeCampaignReference/executions/:safeExecutionReference/cancel', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const execution = await cancelCampaignExecution(c.env.smart_menu_db, references(c, deps));
      return c.json({ success: true, execution });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_EXECUTION_CANCEL_FAILED');
    }
  });
}
