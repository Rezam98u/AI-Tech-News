import express, { Request, Response } from 'express';
import { Server } from 'http';
import client from 'prom-client';
import { logger } from './logger';

export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

export const counters = {
	messagesReceived: new client.Counter({
		name: 'bot_messages_received_total',
		help: 'Total messages received by the bot',
		registers: [metricsRegistry],
	}),
	commandsHandled: new client.Counter({
		name: 'bot_commands_handled_total',
		help: 'Total commands handled by the bot',
		labelNames: ['command'],
		registers: [metricsRegistry],
	}),
	errorsTotal: new client.Counter({
		name: 'bot_errors_total',
		help: 'Total errors encountered',
		labelNames: ['scope'],
		registers: [metricsRegistry],
	}),
	cronRuns: new client.Counter({
		name: 'bot_cron_runs_total',
		help: 'Total scheduler runs',
		registers: [metricsRegistry],
	}),
	cronErrors: new client.Counter({
		name: 'bot_cron_errors_total',
		help: 'Total scheduler run errors',
		registers: [metricsRegistry],
	}),
	postsSent: new client.Counter({
		name: 'bot_posts_sent_total',
		help: 'Total posts sent by scheduler',
		registers: [metricsRegistry],
	}),
};

let metricsServer: Server | null = null;

export function startMetricsServer(port = Number(process.env.METRICS_PORT) || 3000): Server {
	const app = express();

	app.get('/health', (_req: Request, res: Response) => {
		res.status(200).json({ 
			status: 'ok', 
			uptime: process.uptime(),
			timestamp: new Date().toISOString()
		});
	});

	app.get('/metrics', async (_req: Request, res: Response) => {
		try {
			res.set('Content-Type', metricsRegistry.contentType);
			res.end(await metricsRegistry.metrics());
		} catch (err) {
			logger.error({ err }, 'metrics endpoint error');
			res.status(500).end();
		}
	});

	metricsServer = app.listen(port, () => {
		logger.info({ port }, 'metrics server listening');
	});

	return metricsServer;
}

/**
 * Gracefully stop the metrics server
 */
export async function stopMetricsServer(): Promise<void> {
	if (!metricsServer) {
		return;
	}

	return new Promise((resolve, reject) => {
		metricsServer!.close((err) => {
			if (err) {
				logger.error({ err }, 'Error closing metrics server');
				reject(err);
			} else {
				logger.info('Metrics server closed');
				metricsServer = null;
				resolve();
			}
		});
	});
}


