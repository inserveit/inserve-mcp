import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InserveClient, toQueryString } from '../src/client.js';
import { loadConfig } from '../src/config.js';
import { plainTextToHtml } from '../src/format.js';
import { createServer } from '../src/server.js';
import { toDateTime } from '../src/tools.js';

/**
 * Fake fetch that records requests and answers from a route map: { 'GET tickets': body }.
 */
function fakeFetch(routes) {
    const calls = [];

    const fetchImpl = async (url, init) => {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/^\/api\//, '');
        const key = `${init.method} ${path}`;
        calls.push({ key, url: parsed, init, body: init.body ? JSON.parse(init.body) : undefined });

        const route = routes[key];
        const [status, body] = typeof route === 'function' ? route(parsed, init) : route ? [200, route] : [404, { message: 'Not found' }];

        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    };

    return { fetchImpl, calls };
}

async function connect(routes, { readOnly = false } = {}) {
    const { fetchImpl, calls } = fakeFetch(routes);
    const api = new InserveClient({ url: 'https://acme.inserve.test/api', apiKey: 'secret' }, fetchImpl);
    const server = createServer(api, { readOnly, version: 'test' });
    const client = new Client({ name: 'test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    return { client, calls };
}

function json(result) {
    return JSON.parse(result.content[0].text);
}

test('toQueryString encodes nested builder arrays like PHP expects', () => {
    const query = toQueryString({ builder: [{ whereIn: ['status_id', [3, 4]] }, { paginate: 25 }], page: 2 });

    assert.equal(
        decodeURIComponent(query),
        'builder[0][whereIn][0]=status_id&builder[0][whereIn][1][0]=3&builder[0][whereIn][1][1]=4&builder[1][paginate]=25&page=2',
    );
});

test('loadConfig requires url and api key and strips trailing slashes', () => {
    assert.throws(() => loadConfig({}), /INSERVE_URL ontbreekt[\s\S]*INSERVE_API_KEY ontbreekt/);

    const config = loadConfig({ INSERVE_URL: 'https://acme.inserve-api.nl/', INSERVE_API_KEY: 'key', INSERVE_READ_ONLY: 'true' });
    assert.equal(config.url, 'https://acme.inserve-api.nl');
    assert.equal(config.readOnly, true);
    assert.equal(config.allowSelfSigned, false);
});

test('plainTextToHtml escapes html and keeps line breaks', () => {
    assert.equal(plainTextToHtml('<b>hoi</b>\nklant'), '&lt;b&gt;hoi&lt;/b&gt;<br />\nklant');
});

test('read only mode hides write tools', async () => {
    const { client } = await connect({}, { readOnly: true });
    const names = (await client.listTools()).tools.map(tool => tool.name);

    assert.ok(names.includes('search_tickets'));
    assert.ok(!names.includes('create_ticket'));
    assert.ok(!names.includes('log_time'));
});

test('search_tickets sends the api key, filters and returns compact tickets', async () => {
    const { client, calls } = await connect({
        'GET tickets': {
            data: [{ id: 7, reference: 'T-7', description: 'Printer stuk', status: { name: 'Open' }, status_id: 3, company: { name: 'Acme' } }],
            current_page: 1,
            last_page: 1,
            total: 1,
        },
    });

    const result = json(await client.callTool({ name: 'search_tickets', arguments: { status_ids: [3] } }));

    assert.equal(result.total, 1);
    assert.deepEqual(
        { id: result.items[0].id, subject: result.items[0].subject, status: result.items[0].status, company: result.items[0].company },
        { id: 7, subject: 'Printer stuk', status: 'Open', company: 'Acme' },
    );
    assert.equal(calls[0].init.headers['X-Api-Key'], 'secret');
    assert.match(decodeURIComponent(calls[0].url.search), /builder\[\d\]\[whereIn\]\[1\]\[0\]=3/);
});

test('add_ticket_message maps the type to the Inserve action and escapes the message', async () => {
    const { client, calls } = await connect({ 'POST messages': { id: 1, message: '&lt;hi&gt;' } });

    await client.callTool({ name: 'add_ticket_message', arguments: { ticket_id: 5, message: '<hi>', type: 'reply' } });

    assert.deepEqual(calls[0].body, { morphable_type: 'tickets', morphable_id: 5, message: '&lt;hi&gt;', action: 'send' });
});

test('create_ticket only sends given fields', async () => {
    const { client, calls } = await connect({ 'POST tickets': { id: 9, description: 'Nieuw' } });

    await client.callTool({ name: 'create_ticket', arguments: { subject: 'Nieuw', company_id: 4 } });

    assert.deepEqual(calls[0].body, { description: 'Nieuw', company_id: 4 });
});

test('update_ticket without changes returns an error without calling the api', async () => {
    const { client, calls } = await connect({});

    const result = await client.callTool({ name: 'update_ticket', arguments: { ticket_id: 5 } });

    assert.equal(result.isError, true);
    assert.equal(calls.length, 0);
});

test('api errors are returned as readable tool errors', async () => {
    const { client } = await connect({
        'POST tickets': () => [422, { message: 'Ongeldige invoer.', errors: { company_id: ['Bedrijf bestaat niet.'] } }],
        'GET tickets/1': () => [401, { message: 'Unauthenticated.' }],
    });

    const validation = await client.callTool({ name: 'create_ticket', arguments: { subject: 'X', company_id: 999 } });
    assert.equal(validation.isError, true);
    assert.match(validation.content[0].text, /Bedrijf bestaat niet/);

    const unauthorized = await client.callTool({ name: 'get_ticket', arguments: { ticket_id: 1 } });
    assert.match(unauthorized.content[0].text, /API-key/);
});

test('search_tickets uses unqualified columns and refuses priority together with a query', async () => {
    const { client, calls } = await connect({ 'GET tickets': { data: [], total: 0 } });

    await client.callTool({ name: 'search_tickets', arguments: { query: 'printer', status_ids: [3], company_id: 4 } });
    const search = decodeURIComponent(calls[0].url.search);
    assert.match(search, /\[whereIn\]\[0\]=status_id&/);
    assert.match(search, /\[where\]\[0\]=company_id&/);
    assert.doesNotMatch(search, /tickets\./);
    assert.doesNotMatch(search, /orderBy/);

    const refused = await client.callTool({ name: 'search_tickets', arguments: { query: 'printer', priority_ids: [1] } });
    assert.equal(refused.isError, true);
    assert.equal(calls.length, 1);
});

test('get_ticket only fetches the latest messages', async () => {
    const { client, calls } = await connect({
        'GET tickets/5': { id: 5, description: 'VPN', messages_count: 300, time_registrations: [{ id: 1, time_spent: 15 }] },
        'GET messages': { data: [{ id: 2, message: '<p>Nieuw</p>' }] },
    });

    const ticket = json(await client.callTool({ name: 'get_ticket', arguments: { ticket_id: 5 } }));

    assert.equal(ticket.messages_count, 300);
    assert.deepEqual(ticket.messages.map(message => message.message), ['Nieuw']);
    assert.equal(ticket.time_registrations[0].minutes, 15);

    const messagesCall = calls.find(call => call.key === 'GET messages');
    assert.match(decodeURIComponent(messagesCall.url.search), /\[paginate\]=20/);
    assert.match(decodeURIComponent(messagesCall.url.search), /\[where\]\[1\]=5/);
    assert.match(decodeURIComponent(messagesCall.url.search), /\[whereInOrNull\]\[0\]=type&/);
    assert.doesNotMatch(decodeURIComponent(messagesCall.url.search), /status-changed/);
});

test('toDateTime keeps the given date for a date without time', () => {
    assert.equal(toDateTime('2026-10-23'), '2026-10-23 00:00:00');
    assert.equal(toDateTime('2026-10-23 14:30'), '2026-10-23 14:30:00');
    assert.throws(() => toDateTime('gisteren'), /Ongeldige datum/);
});

test('html in api error messages is removed', async () => {
    const { client } = await connect({
        'POST messages': () => [500, { message: 'Het versturen van het bericht is niet gelukt:<br/>SMTP fout' }],
    });

    const result = await client.callTool({ name: 'add_ticket_message', arguments: { ticket_id: 1, message: 'Hoi' } });

    assert.equal(result.content[0].text, 'Inserve gaf een fout (500): Het versturen van het bericht is niet gelukt: SMTP fout');
});

test('set_ticket_categories adds and removes categories and keeps the others', async () => {
    let categories = [{ id: 1, title: 'Hardware' }, { id: 2, title: 'Software' }];
    const { client, calls } = await connect({
        'GET tickets/5': () => [200, { id: 5, reference: 'T-5', description: 'VPN', categories }],
        'GET categories': [{ id: 3, title: 'Netwerk' }],
        'PUT tickets/5': (url, init) => {
            const ids = JSON.parse(init.body).relationships.categories.sync;
            categories = ids.map(id => ({ id, title: `Categorie ${id}` }));
            return [200, { id: 5 }];
        },
    });

    const result = json(await client.callTool({ name: 'set_ticket_categories', arguments: { ticket_id: 5, add: [3], remove: [2] } }));

    const put = calls.find(call => call.key === 'PUT tickets/5');
    assert.deepEqual(put.body, { relationships: { categories: { sync: [1, 3] } } });
    assert.equal(result.changed, true);
    assert.deepEqual(result.categories.map(category => category.id), [1, 3]);

    const lookup = calls.find(call => call.key === 'GET categories');
    assert.match(decodeURIComponent(lookup.url.search), /\[where\]\[0\]=type&builder\[0\]\[where\]\[1\]=0/);
});

test('set_ticket_categories does not save when nothing changes', async () => {
    const { client, calls } = await connect({
        'GET tickets/5': { id: 5, categories: [{ id: 1, title: 'Hardware' }] },
        'GET categories': [{ id: 1, title: 'Hardware' }],
    });

    const result = json(await client.callTool({ name: 'set_ticket_categories', arguments: { ticket_id: 5, add: [1] } }));

    assert.equal(result.changed, false);
    assert.equal(calls.some(call => call.key === 'PUT tickets/5'), false);
});

test('set_ticket_categories refuses unknown, conflicting or missing categories', async () => {
    const { client, calls } = await connect({
        'GET tickets/5': { id: 5, categories: [] },
        'GET categories': [],
    });

    const unknown = await client.callTool({ name: 'set_ticket_categories', arguments: { ticket_id: 5, add: [99] } });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content[0].text, /Onbekende ticketcategorie: 99/);

    const conflicting = await client.callTool({ name: 'set_ticket_categories', arguments: { ticket_id: 5, add: [1], remove: [1] } });
    assert.equal(conflicting.isError, true);

    const empty = await client.callTool({ name: 'set_ticket_categories', arguments: { ticket_id: 5 } });
    assert.equal(empty.isError, true);

    assert.equal(calls.some(call => call.key === 'PUT tickets/5'), false);
});

test('set_ticket_categories is hidden in read only mode', async () => {
    const { client } = await connect({}, { readOnly: true });
    const names = (await client.listTools()).tools.map(tool => tool.name);

    assert.ok(!names.includes('set_ticket_categories'));
});

test('list_lookups skips lookups the user has no permission for', async () => {
    const { client } = await connect({
        'GET ticket-statuses': [{ id: 3, name: 'Open' }],
        'GET priorities': [{ id: 1, label: 'Hoog' }],
        'GET operators': () => [403, { message: 'Geen rechten' }],
    });

    const lookups = json(await client.callTool({ name: 'list_lookups', arguments: {} }));

    assert.deepEqual(lookups.ticket_statuses, [{ id: 3, name: 'Open' }]);
    assert.deepEqual(lookups.priorities, [{ id: 1, name: 'Hoog' }]);
    assert.equal(lookups.operators, undefined);
});
