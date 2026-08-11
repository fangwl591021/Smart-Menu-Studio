import { loadCampaignAudienceSource } from './audiences';
import {
  archiveCampaign,
  campaignAudienceRead,
  campaignByReference,
  createCampaign,
  listCampaigns,
  prepareCampaign,
  replayPreparedCampaign,
  previewCampaignAudience,
  updateCampaign,
} from './campaigns';
import { resolveSegmentReferences } from '../crm/segment-routes';

const KNOWN_ERROR = /^CAMPAIGN_[A-Z0-9_]+$/;

function fail(c: any, error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : '';
  const code = raw === 'FORBIDDEN_ROLE' ? 'FORBIDDEN' : KNOWN_ERROR.test(raw) ? raw : fallback;
  const status = code === 'FORBIDDEN' ? 403 : code.endsWith('_NOT_FOUND') ? 404 :
    code.endsWith('_CONFLICT') || code.endsWith('_NOT_DRAFT') || code.endsWith('_UNSUPPORTED') ? 409 : 400;
  return c.json({ success: false, error: code }, status);
}

async function campaignSegmentContext(c: any, deps: any, safeSegmentReference: unknown) {
  const workspaceId = deps.workspaceIdOf(c);
  const reference = deps.text(safeSegmentReference, 100);
  if (!reference) throw new Error('CAMPAIGN_SEGMENT_REQUIRED');
  const source = await loadCampaignAudienceSource(c.env.smart_menu_db, workspaceId, reference);
  const resolved = await resolveSegmentReferences(
    c.env.smart_menu_db,
    workspaceId,
    String(c.env.CRM_ASSIGNEE_HANDLE_SECRET || ''),
    source.rule,
  );
  return { workspaceId, source, executionRule: resolved.execution };
}

export function registerCampaignRoutes(app: any, deps: any) {
  app.get('/api/campaigns', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      return c.json({ success: true, campaigns: await listCampaigns(c.env.smart_menu_db, deps.workspaceIdOf(c)) });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_LIST_FAILED');
    }
  });

  app.post('/api/campaigns', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const body: any = await c.req.json().catch(() => ({}));
      const campaign = await createCampaign(c.env.smart_menu_db, {
        workspaceId: deps.workspaceIdOf(c),
        name: body.name,
        description: body.description,
        content: body.content,
        userId: deps.text(c.get('userId')) || null,
      });
      return c.json({ success: true, campaign }, 201);
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_CREATE_FAILED');
    }
  });

  app.get('/api/campaigns/:safeCampaignReference', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const campaign = await campaignByReference(
        c.env.smart_menu_db,
        deps.workspaceIdOf(c),
        deps.text(c.req.param('safeCampaignReference'), 100),
      );
      return c.json({ success: true, campaign });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_READ_FAILED');
    }
  });

  app.patch('/api/campaigns/:safeCampaignReference', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const patch: any = await c.req.json().catch(() => ({}));
      const campaign = await updateCampaign(c.env.smart_menu_db, {
        workspaceId: deps.workspaceIdOf(c),
        safeCampaignReference: deps.text(c.req.param('safeCampaignReference'), 100),
        patch,
        userId: deps.text(c.get('userId')) || null,
      });
      return c.json({ success: true, campaign });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_UPDATE_FAILED');
    }
  });

  app.post('/api/campaigns/:safeCampaignReference/status', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const body: any = await c.req.json().catch(() => ({}));
      if (String(body.status || '').trim().toUpperCase() !== 'ARCHIVED') throw new Error('CAMPAIGN_STATUS_INVALID');
      const campaign = await archiveCampaign(
        c.env.smart_menu_db,
        deps.workspaceIdOf(c),
        deps.text(c.req.param('safeCampaignReference'), 100),
      );
      return c.json({ success: true, campaign });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_STATUS_FAILED');
    }
  });

  app.post('/api/campaigns/:safeCampaignReference/preview', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const body: any = await c.req.json().catch(() => ({}));
      const context = await campaignSegmentContext(c, deps, body.safeSegmentReference);
      const preview = await previewCampaignAudience(c.env.smart_menu_db, {
        ...context,
        safeCampaignReference: deps.text(c.req.param('safeCampaignReference'), 100),
      });
      return c.json({ success: true, preview });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_PREVIEW_FAILED');
    }
  });

  app.post('/api/campaigns/:safeCampaignReference/prepare', async (c: any) => {
    try {
      deps.requireRole(c, 'admin');
      const body: any = await c.req.json().catch(() => ({}));
      const workspaceId = deps.workspaceIdOf(c);
      const safeCampaignReference = deps.text(c.req.param('safeCampaignReference'), 100);
      const replay = await replayPreparedCampaign(c.env.smart_menu_db, {
        workspaceId,
        safeCampaignReference,
        actionReference: body.actionReference,
      });
      if (replay) return c.json({ success: true, prepared: replay });
      const context = await campaignSegmentContext(c, deps, body.safeSegmentReference);
      const prepared = await prepareCampaign(c.env.smart_menu_db, {
        ...context,
        workspaceId,
        safeCampaignReference,
        actionReference: body.actionReference,
        userId: deps.text(c.get('userId')) || null,
        signingSecret: String(c.env.MEMBER_IDENTITY_HMAC_SECRET || ''),
      });
      return c.json({ success: true, prepared });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_PREPARE_FAILED');
    }
  });

  app.get('/api/campaigns/:safeCampaignReference/audience', async (c: any) => {
    try {
      deps.requireRole(c, 'viewer');
      const result = await campaignAudienceRead(
        c.env.smart_menu_db,
        deps.workspaceIdOf(c),
        deps.text(c.req.param('safeCampaignReference'), 100),
      );
      return c.json({ success: true, ...result });
    } catch (error) {
      return fail(c, error, 'CAMPAIGN_AUDIENCE_READ_FAILED');
    }
  });
}
