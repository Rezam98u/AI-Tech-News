import express, { Request, Response } from 'express';
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
};

export function startMetricsServer(port = Number(process.env.METRICS_PORT) || 3000): void {
	const app = express();

	app.get('/health', (_req: Request, res: Response) => {
		res.status(200).send('ok');
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

	app.listen(port, () => {
		logger.info({ port }, 'metrics server listening');
	});
}


