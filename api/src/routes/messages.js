import { Router } from 'express';
import Joi from 'joi';
import { authMiddleware } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { addJob, getJobStatus } from '../queue.js';

const router = Router();

router.post('/send', authMiddleware, validateBody(Joi.object({
    accountId: Joi.string().required(),
    recipientProfileUrl: Joi.string().uri().required(),
    message: Joi.string().min(1).max(300).required(),
    proxyUrl: Joi.string().uri().optional()
})), async (req, res, next) => {
    try {
        const job = await addJob('sendMessage', req.body);
        res.status(201).json({ jobId: job.id, status: 'queued' });
    } catch (err) {
        next(err);
    }
});

router.post('/read', authMiddleware, validateBody(Joi.object({
    accountId: Joi.string().required(),
    proxyUrl: Joi.string().uri().optional()
})), async (req, res, next) => {
    try {
        const job = await addJob('readMessages', req.body);
        res.status(201).json({ jobId: job.id, status: 'queued' });
    } catch (err) {
        next(err);
    }
});

router.get('/job/:jobId', authMiddleware, async (req, res, next) => {
    try {
        const status = await getJobStatus(req.params.jobId);
        if (!status) return res.status(404).json({ error: 'Job not found' });
        res.json(status);
    } catch (err) {
        next(err);
    }
});

export default router;
