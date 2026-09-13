import { Router } from 'express';
import { SoftwareController } from '../controllers/SoftwareController';

const router = Router();

router.get('/providers', SoftwareController.listProviders);
router.get('/providers/:providerId/versions', SoftwareController.getMcVersions);
router.get('/providers/:providerId/versions/:mcVersion/releases', SoftwareController.getReleases);

export default router;
