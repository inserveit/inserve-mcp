import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { defineTools } from './tools.js';

export const INSTRUCTIONS = `Inserve is a PSA platform for IT service providers (MSPs). You act on behalf of the Inserve user the API key belongs to.

Terminology:
- Company: a customer (relation) of the MSP. Contact: a contact person of a company.
- Ticket: a support request. "reference" is the ticket number users mention, "id" is the technical id the tools use.
- Statuses, priorities, ticket types, activities and operators differ per environment; get their ids with list_lookups.
- Time registrations are in minutes.

Guidelines:
- Search first when the user mentions a ticket number, company or person by name, then use the returned ids.
- Replies of type "reply" or "reply_and_close" are e-mailed to the contact: always show the text and get explicit confirmation first.
- Messages are plain text; do not add a signature.`;

/**
 * @param {import('./client.js').InserveClient} api
 * @param {{ readOnly: boolean, version: string }} options
 */
export function createServer(api, { readOnly, version }) {
    const server = new McpServer({ name: 'inserve-mcp', title: 'Inserve-MCP', version }, { instructions: INSTRUCTIONS });

    for (const tool of defineTools(api)) {
        if (readOnly && tool.write) {
            continue;
        }

        server.registerTool(tool.name, {
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
        }, async input => {
            try {
                const result = await tool.handler(input ?? {});

                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (error) {
                return { content: [{ type: 'text', text: error.message }], isError: true };
            }
        });
    }

    return server;
}
