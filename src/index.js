#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InserveClient } from './client.js';
import { loadConfig } from './config.js';
import { createServer } from './server.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let config;
try {
    config = loadConfig();
} catch (error) {
    // Stdout is reserved for the MCP protocol, so report on stderr; the MCP client shows it in its logs.
    console.error(error.message);
    process.exit(1);
}

if (config.allowSelfSigned) {
    // Only meant for local development against a self-signed Inserve environment.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    console.error('Let op: certificaatcontrole staat uit (INSERVE_ALLOW_SELF_SIGNED).');
}

const server = createServer(new InserveClient(config), { readOnly: config.readOnly, version });

await server.connect(new StdioServerTransport());
