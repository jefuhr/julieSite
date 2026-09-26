'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Starts server.js the way systemd does, on a random free port. Resolves
 * once it's listening. `alive()` says whether the process is still running;
 * `stop()` shuts it down.
 */
function startServer() {
	return new Promise((resolve, reject) => {
		const proc = spawn(process.execPath, ['server.js'], {
			cwd: ROOT,
			env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		let log = '';
		proc.stdout.on('data', (chunk) => {
			log += chunk;
			const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(log);
			if (m) {
				resolve({
					port: Number(m[1]),
					log: () => log,
					alive: () => proc.exitCode === null && proc.signalCode === null,
					stop: () => proc.kill(),
				});
			}
		});
		proc.stderr.on('data', (chunk) => (log += chunk));
		proc.on('exit', (code) => reject(new Error(`server exited (${code}) before listening:\n${log}`)));
	});
}

/** One raw HTTP request. `target` is sent exactly as given, malformed or not. */
function request(port, target, { method = 'GET', headers = {} } = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => resolve({
				status: res.statusCode,
				headers: res.headers,
				body: Buffer.concat(chunks).toString('utf8'),
			}));
		});
		req.on('error', reject);
		req.end();
	});
}

module.exports = { ROOT, startServer, request };
