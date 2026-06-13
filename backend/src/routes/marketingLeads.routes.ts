import { Router } from 'express';
import { authMiddleware, marketingAdsAccessMiddleware } from '../middleware/auth';
import {
  createLead,
  getLeadMetrics,
  listLeads,
  removeLead,
  updateLead
} from '../controllers/marketingLeads.controller';
import {
  getLeadsWebhookConfig,
  inboundLeadWebhook,
  metaLeadWebhook,
  saveLeadsWebhookConfig
} from '../controllers/marketingLeadsWebhook.controller';

const router = Router();

router.post('/leads/webhook/inbound', inboundLeadWebhook);
router.get('/leads/webhook/meta', metaLeadWebhook);
router.post('/leads/webhook/meta', metaLeadWebhook);

router.get('/leads/webhook/config', authMiddleware, getLeadsWebhookConfig);
router.put('/leads/webhook/config', authMiddleware, saveLeadsWebhookConfig);

router.use(authMiddleware, marketingAdsAccessMiddleware);
router.get('/leads/metrics', getLeadMetrics);
router.get('/leads', listLeads);
router.post('/leads', createLead);
router.patch('/leads/:id', updateLead);
router.delete('/leads/:id', removeLead);

export default router;
