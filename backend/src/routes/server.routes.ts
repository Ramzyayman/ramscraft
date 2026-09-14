import { Router } from 'express';
import { ServerController } from '../controllers/ServerController';
import { SoftwareController } from '../controllers/SoftwareController';
import { LifecycleController } from '../controllers/LifecycleController';

const router = Router();

router.get('/', ServerController.listServers);
router.post('/', ServerController.createServer);
router.get('/:id', ServerController.getServer);
router.patch('/:id', ServerController.updateServer);
router.delete('/:id', ServerController.deleteServer);

// Phase 2: Software Installation metadata setup
router.post('/:serverId/software/install', SoftwareController.prepareInstallation);
router.get('/:serverId/software/install', SoftwareController.installStatus);

export default router;

// Phase 3: Lifecycle
router.post('/:id/lifecycle/start', LifecycleController.start);
router.post('/:id/lifecycle/stop', LifecycleController.stop);
router.post('/:id/lifecycle/kill', LifecycleController.kill);
router.post('/:id/lifecycle/eula', LifecycleController.acceptEula);
