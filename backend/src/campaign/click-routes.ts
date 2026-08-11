import { campaignClickList, campaignClickSummary, resolveCampaignClick } from './clicks.ts';

const KNOWN_ERROR = /^CAMPAIGN_[A-Z0-9_]+$/;
function fail(c: any, error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';
  const code = raw === 'FORBIDDEN_ROLE' ? 'FORBIDDEN' : KNOWN_ERROR.test(raw) ? raw : fallback;
  const status = code === 'FORBIDDEN' ? 403 : code.endsWith('_NOT_FOUND') ? 404 : 400;
  return c.json({ success: false, error: code }, status);
}

export function registerCampaignClickRoutes(app: any, deps: any) {
  app.get('/t/:opaqueReference', async (c: any) => {
    try {
      const resolved = await resolveCampaignClick(c.env.smart_menu_db, {
        opaqueReference: deps.text(c.req.param('opaqueReference'), 80),
        recipientContext: c.req.query('c') == null ? null : deps.text(c.req.query('c'), 80),
        signingSecret: String(c.env.MEMBER_IDENTITY_HMAC_SECRET || ''),
      });
      if (!resolved) return c.text('Not found', 404);
      c.executionCtx.waitUntil(resolved.evidence.catch(() => undefined));
      return c.redirect(resolved.destinationUrl, 302);
    } catch {
      return c.text('Not found', 404);
    }
  });

  app.get('/api/campaigns/:safeCampaignReference/clicks/summary', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const summary = await campaignClickSummary(
        c.env.smart_menu_db, deps.workspaceIdOf(c), deps.text(c.req.param('safeCampaignReference'), 100),
      );
      return c.json({ success: true, summary });
    } catch (error) { return fail(c, error, 'CAMPAIGN_CLICK_SUMMARY_FAILED'); }
  });

  app.get('/api/campaigns/:safeCampaignReference/clicks', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const requestedLimit = Number(c.req.query('limit') || 25);
      const result = await campaignClickList(c.env.smart_menu_db, {
        workspaceId: deps.workspaceIdOf(c),
        campaignReference: deps.text(c.req.param('safeCampaignReference'), 100),
        limit: Number.isFinite(requestedLimit) ? requestedLimit : 25,
        cursor: c.req.query('cursor') || null,
        signingSecret: String(c.env.MEMBER_IDENTITY_HMAC_SECRET || ''),
      });
      return c.json({ success: true, ...result });
    } catch (error) { return fail(c, error, 'CAMPAIGN_CLICK_LIST_FAILED'); }
  });
}
