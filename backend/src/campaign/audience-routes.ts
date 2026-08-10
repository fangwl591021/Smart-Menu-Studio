import { resolveSegmentReferences } from '../crm/segment-routes';
import {
  archiveCampaignAudience,
  campaignAudienceByReference,
  campaignAudienceRefreshContext,
  createCampaignAudience,
  listCampaignAudienceMembers,
  listCampaignAudiences,
  loadCampaignAudienceSource,
  refreshCampaignAudience,
} from './audiences';

const KNOWN_ERROR = /^CAMPAIGN_[A-Z0-9_]+$/;

function fail(c: any, error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';
  const code = raw === 'FORBIDDEN_ROLE' ? 'FORBIDDEN' : KNOWN_ERROR.test(raw) ? raw : fallback;
  const status = code === 'FORBIDDEN' ? 403 : code.endsWith('_NOT_FOUND') ? 404 :
    code.endsWith('_CONFLICT') || code.endsWith('_ARCHIVED') || code.endsWith('_TOO_LARGE') ? 409 : 400;
  return c.json({ success: false, error: code }, status);
}

export function registerCampaignAudienceRoutes(app: any, deps: any) {
  app.get('/api/campaign/audiences', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      return c.json({
        success: true,
        audiences: await listCampaignAudiences(c.env.smart_menu_db, deps.workspaceIdOf(c)),
      });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_AUDIENCE_LIST_FAILED');
    }
  });

  app.post('/api/campaign/audiences', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const body: any = await c.req.json().catch(() => ({}));
      const workspaceId = deps.workspaceIdOf(c);
      const safeSegmentReference = deps.text(body.safeSegmentReference, 100);
      if (!safeSegmentReference) throw new Error('CAMPAIGN_AUDIENCE_SEGMENT_REQUIRED');
      const source = await loadCampaignAudienceSource(c.env.smart_menu_db, workspaceId, safeSegmentReference);
      const resolved = await resolveSegmentReferences(
        c.env.smart_menu_db,
        workspaceId,
        String(c.env.CRM_ASSIGNEE_HANDLE_SECRET || ''),
        source.rule,
      );
      const audience = await createCampaignAudience(c.env.smart_menu_db, {
        workspaceId,
        name: body.name,
        description: body.description,
        source,
        executionRule: resolved.execution,
        userId: deps.text(c.get('userId')) || null,
      });
      return c.json({ success: true, audience }, 201);
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_AUDIENCE_CREATE_FAILED');
    }
  });

  app.get('/api/campaign/audiences/:safeAudienceReference', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const audience = await campaignAudienceByReference(
        c.env.smart_menu_db,
        deps.workspaceIdOf(c),
        deps.text(c.req.param('safeAudienceReference'), 100),
      );
      return c.json({ success: true, audience });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_AUDIENCE_READ_FAILED');
    }
  });

  app.get('/api/campaign/audiences/:safeAudienceReference/members', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const eligibility = String(c.req.query('eligibility') || 'ALL').trim().toUpperCase();
      if (!['ALL', 'ELIGIBLE', 'EXCLUDED'].includes(eligibility)) {
        throw new Error('CAMPAIGN_AUDIENCE_ELIGIBILITY_FILTER_INVALID');
      }
      const requestedLimit = Number(c.req.query('limit') || 25);
      const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : 25, 1), 100);
      const result = await listCampaignAudienceMembers(c.env.smart_menu_db, {
        workspaceId: deps.workspaceIdOf(c),
        safeAudienceReference: deps.text(c.req.param('safeAudienceReference'), 100),
        eligibility,
        limit,
      });
      return c.json({ success: true, ...result });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_AUDIENCE_MEMBER_LIST_FAILED');
    }
  });

  app.post('/api/campaign/audiences/:safeAudienceReference/snapshots', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const workspaceId = deps.workspaceIdOf(c);
      const safeAudienceReference = deps.text(c.req.param('safeAudienceReference'), 100);
      const context = await campaignAudienceRefreshContext(c.env.smart_menu_db, workspaceId, safeAudienceReference);
      const resolved = await resolveSegmentReferences(
        c.env.smart_menu_db,
        workspaceId,
        String(c.env.CRM_ASSIGNEE_HANDLE_SECRET || ''),
        context.source.rule,
      );
      const audience = await refreshCampaignAudience(c.env.smart_menu_db, {
        workspaceId,
        safeAudienceReference,
        audienceId: context.audienceId,
        currentSnapshotNo: context.currentSnapshotNo,
        source: context.source,
        executionRule: resolved.execution,
        userId: deps.text(c.get('userId')) || null,
      });
      return c.json({ success: true, audience });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_AUDIENCE_SNAPSHOT_FAILED');
    }
  });

  app.post('/api/campaign/audiences/:safeAudienceReference/status', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const body: any = await c.req.json().catch(() => ({}));
      if (String(body.status || '').trim().toUpperCase() !== 'ARCHIVED') {
        throw new Error('CAMPAIGN_AUDIENCE_STATUS_INVALID');
      }
      const audience = await archiveCampaignAudience(
        c.env.smart_menu_db,
        deps.workspaceIdOf(c),
        deps.text(c.req.param('safeAudienceReference'), 100),
      );
      return c.json({ success: true, audience });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_AUDIENCE_STATUS_FAILED');
    }
  });
}
