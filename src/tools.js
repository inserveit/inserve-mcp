import { z } from 'zod';
import {
    plainTextToHtml,
    presentAsset,
    presentCategories,
    presentCompany,
    presentContact,
    presentMessage,
    presentPage,
    presentTicket,
    presentTimeRegistration,
    fullName,
} from './format.js';

const TICKET_CLASS = 'App\\Models\\Tenant\\Ticket';

const MESSAGES_PER_TICKET = 20;

const CATEGORY_TYPE_TICKET = 0;

const MESSAGE_TYPES_EXCEPT_STATUS_CHANGES = [
    'work-order-signed',
    'deal-created',
    'contract-upgraded',
    'quote-signed',
    'reply-from-message',
];

const page = z.number().int().min(1).default(1).describe('Paginanummer.');
const perPage = z.number().int().min(1).max(100).default(25).describe('Aantal resultaten per pagina (max 100).');

const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/**
 * MCP message types mapped to the `action` of the Inserve messages endpoint.
 */
const MESSAGE_ACTIONS = {
    internal_note: 'note',
    visible_note: 'note_visible',
    reply: 'send',
    reply_and_close: 'send_close',
};

/**
 * @param {import('./client.js').InserveClient} api
 */
export function defineTools(api) {
    return [
        {
            name: 'search_tickets',
            title: 'Tickets zoeken',
            description: 'Search tickets, newest first. Filter on free text (reference, subject), status, priority, company or operator. Use list_lookups to find status, priority and operator ids. The priority filter cannot be combined with a free text query.',
            annotations: READ,
            inputSchema: {
                query: z.string().max(255).optional().describe('Free text search on reference and subject.'),
                status_ids: z.array(z.number().int()).optional().describe('Only tickets with one of these statuses.'),
                priority_ids: z.array(z.number().int()).optional().describe('Only tickets with one of these priorities. Not combinable with query.'),
                company_id: z.number().int().optional().describe('Only tickets of this company.'),
                operator_id: z.number().int().optional().describe('Only tickets assigned to this operator.'),
                page,
                per_page: perPage,
            },
            async handler({ query, status_ids, priority_ids, company_id, operator_id, page = 1, per_page = 25 }) {
                // With a search engine, filters are applied in the search index, which only knows status,
                // company and operator. Column names must be unqualified for the same reason.
                if (query && priority_ids?.length) {
                    throw new Error('Filteren op prioriteit kan niet samen met een zoekterm. Zoek zonder zoekterm of zonder prioriteit.');
                }

                // Search results are ordered by relevance, otherwise show the newest tickets first.
                const builder = [
                    { with: ['status', 'priority', 'company', 'client', 'operator'] },
                    query ? { s: query } : { orderBy: ['id', 'desc'] },
                ];

                if (status_ids?.length) {
                    builder.push({ whereIn: ['status_id', status_ids] });
                }

                if (priority_ids?.length) {
                    builder.push({ whereIn: ['priority_id', priority_ids] });
                }

                if (company_id) {
                    builder.push({ where: ['company_id', company_id] });
                }

                if (operator_id) {
                    builder.push({ where: ['operator_id', operator_id] });
                }

                builder.push({ paginate: per_page });

                return presentPage(await api.get('tickets', { builder, page }), presentTicket);
            },
        },
        {
            name: 'get_ticket',
            title: 'Ticket bekijken',
            description: `Get a single ticket including its categories, time registrations and the latest ${MESSAGES_PER_TICKET} messages (newest first). Use the ticket id, not the reference; search first when you only know the reference.`,
            annotations: READ,
            inputSchema: {
                ticket_id: z.number().int().min(1).describe('The ticket id (not the reference).'),
            },
            async handler({ ticket_id }) {
                const [ticket, messages] = await Promise.all([
                    api.get(`tickets/${ticket_id}`, {
                        load: ['status', 'priority', 'company', 'client', 'operator', 'categories', 'timeRegistrations.actor', 'timeRegistrations.activity'],
                        loadCount: ['messages'],
                    }),
                    // Only the latest messages, long tickets can have hundreds of them.
                    api.get('messages', {
                        builder: [
                            { with: ['actor'] },
                            { where: ['morphable_type', TICKET_CLASS] },
                            { where: ['morphable_id', ticket_id] },
                            // Every message type except the automatic status change notes (type null is a regular message).
                            { whereInOrNull: ['type', MESSAGE_TYPES_EXCEPT_STATUS_CHANGES] },
                            { orderBy: ['id', 'desc'] },
                            { paginate: MESSAGES_PER_TICKET },
                        ],
                    }),
                ]);

                return {
                    ...presentTicket(ticket),
                    categories: presentCategories(ticket.categories),
                    messages_count: ticket.messages_count ?? null,
                    messages: (messages?.data ?? []).map(presentMessage),
                    time_registrations: (ticket.time_registrations ?? []).map(presentTimeRegistration),
                };
            },
        },
        {
            name: 'search_companies',
            title: 'Relaties zoeken',
            description: 'Search companies (relations / customers of the MSP) by name. Archived companies are excluded.',
            annotations: READ,
            inputSchema: {
                query: z.string().max(255).optional().describe('Free text search, for example (part of) the company name.'),
                page,
                per_page: perPage,
            },
            async handler({ query, page = 1, per_page = 25 }) {
                const builder = [
                    query ? { s: query } : { orderBy: ['name', 'asc'] },
                    { whereNull: 'archived_at' },
                    { paginate: per_page },
                ];

                return presentPage(await api.get('companies', { builder, page }), presentCompany);
            },
        },
        {
            name: 'get_company',
            title: 'Relatie bekijken',
            description: 'Get a single company including its contacts and number of tickets.',
            annotations: READ,
            inputSchema: {
                company_id: z.number().int().min(1),
            },
            async handler({ company_id }) {
                const company = await api.get(`companies/${company_id}`, {
                    load: ['clients'],
                    loadCount: ['tickets'],
                });

                return {
                    ...presentCompany(company),
                    tickets_count: company.tickets_count ?? null,
                    contacts: (company.clients ?? []).map(presentContact),
                };
            },
        },
        {
            name: 'search_contacts',
            title: 'Contactpersonen zoeken',
            description: 'Search contacts (contact persons of companies) by name or e-mail address, optionally within one company.',
            annotations: READ,
            inputSchema: {
                query: z.string().max(255).optional().describe('Free text search on name or e-mail address.'),
                company_id: z.number().int().optional().describe('Only contacts of this company.'),
                page,
                per_page: perPage,
            },
            async handler({ query, company_id, page = 1, per_page = 25 }) {
                const builder = [
                    { with: ['companies'] },
                    query ? { s: query } : { orderBy: ['first_name', 'asc'] },
                ];

                if (company_id) {
                    builder.push({ whereHas: ['companies', 'companies.id', [company_id]] });
                }

                builder.push({ paginate: per_page });

                return presentPage(await api.get('clients', { builder, page }), presentContact);
            },
        },
        {
            name: 'search_assets',
            title: 'Assets zoeken',
            description: 'Search assets (devices, licenses and other configuration items) by name or serial number, optionally within one company.',
            annotations: READ,
            inputSchema: {
                query: z.string().max(255).optional().describe('Free text search on name or serial number.'),
                company_id: z.number().int().optional().describe('Only assets of this company.'),
                page,
                per_page: perPage,
            },
            async handler({ query, company_id, page = 1, per_page = 25 }) {
                const builder = [
                    { with: ['status', 'company', 'client'] },
                    query ? { s: query } : { orderBy: ['name', 'asc'] },
                ];

                if (company_id) {
                    builder.push({ where: ['company_id', company_id] });
                }

                builder.push({ paginate: per_page });

                return presentPage(await api.get('assets', { builder, page }), presentAsset);
            },
        },
        {
            name: 'list_time_registrations',
            title: 'Tijdregistraties bekijken',
            description: 'List time registrations, newest first. Filter on operator, ticket, company and a date range (YYYY-MM-DD). Durations are in minutes.',
            annotations: READ,
            inputSchema: {
                operator_id: z.number().int().optional().describe('Only time registered by this operator.'),
                ticket_id: z.number().int().optional().describe('Only time registered on this ticket.'),
                company_id: z.number().int().optional().describe('Only time registered for this company.'),
                from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Executed on or after this date.'),
                until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Executed on or before this date.'),
                page,
                per_page: perPage,
            },
            async handler({ operator_id, ticket_id, company_id, from, until, page = 1, per_page = 25 }) {
                const builder = [
                    { with: ['actor', 'activity'] },
                    { orderBy: ['executed_at', 'desc'] },
                ];

                if (operator_id) {
                    builder.push({ where: ['actor_id', operator_id] });
                }

                if (ticket_id) {
                    builder.push({ where: ['morphable_type', TICKET_CLASS] });
                    builder.push({ where: ['morphable_id', ticket_id] });
                }

                if (company_id) {
                    builder.push({ where: ['company_id', company_id] });
                }

                if (from) {
                    builder.push({ where: ['executed_at', '>=', `${from} 00:00:00`] });
                }

                if (until) {
                    builder.push({ where: ['executed_at', '<=', `${until} 23:59:59`] });
                }

                builder.push({ paginate: per_page });

                return presentPage(await api.get('time-registrations', { builder, page }), presentTimeRegistration);
            },
        },
        {
            name: 'list_lookups',
            title: 'Keuzelijsten ophalen',
            description: 'List the ids and names of ticket statuses, priorities, ticket types, ticket categories, activities (for time registrations) and operators. Use these ids when filtering or changing records.',
            annotations: READ,
            inputSchema: {},
            async handler() {
                const sources = {
                    ticket_statuses: ['ticket-statuses', record => record.name],
                    priorities: ['priorities', record => record.label],
                    ticket_types: ['ticket-types', record => record.name],
                    // Type 0 are the ticket categories, the other types belong to assets.
                    ticket_categories: ['categories', record => record.title, [{ where: ['type', CATEGORY_TYPE_TICKET] }, { orderBy: ['order', 'asc'] }]],
                    activities: ['activities', record => record.name],
                    operators: ['operators', record => fullName(record)],
                };

                const lookups = {};

                // Lookups the API key user has no permission for are left out.
                await Promise.all(Object.entries(sources).map(async ([key, [endpoint, name, filters = []]]) => {
                    try {
                        const records = await api.get(endpoint, { builder: [...filters, { limit: 500 }] });
                        lookups[key] = (records ?? []).map(record => ({ id: record.id, name: name(record) }));
                    } catch {
                        // Skip
                    }
                }));

                return lookups;
            },
        },
        {
            name: 'create_ticket',
            title: 'Ticket aanmaken',
            write: true,
            description: 'Create a ticket. The contact can be given by id or by e-mail address; with an e-mail address the matching contact and (when unambiguous) its company are linked automatically. The first message is stored as an internal note and is not e-mailed to the contact.',
            annotations: WRITE,
            inputSchema: {
                subject: z.string().min(1).max(255).describe('Short subject of the ticket.'),
                message: z.string().max(20000).optional().describe('Description of the request or problem, plain text.'),
                company_id: z.number().int().optional(),
                contact_id: z.number().int().optional(),
                contact_email: z.string().email().optional().describe('Link the contact with this e-mail address.'),
                operator_id: z.number().int().optional().describe('Assign the ticket to this operator.'),
                priority_id: z.number().int().optional().describe('Defaults to the default priority.'),
                ticket_type_id: z.number().int().optional().describe('Defaults to the default ticket type.'),
            },
            async handler(input) {
                // Only send given fields, Inserve falls back to its defaults for missing fields.
                const ticket = await api.post('tickets', withoutEmpty({
                    description: input.subject,
                    message: input.message !== undefined ? plainTextToHtml(input.message) : undefined,
                    company_id: input.company_id,
                    client_id: input.contact_id,
                    email: input.contact_email,
                    operator_id: input.operator_id,
                    priority_id: input.priority_id,
                    ticket_type_id: input.ticket_type_id,
                }));

                return presentTicket(ticket);
            },
        },
        {
            name: 'add_ticket_message',
            title: 'Notitie of bericht toevoegen aan ticket',
            write: true,
            description: 'Add a note or message to a ticket. Type "internal_note" (default) is a hidden note, only visible to operators and never shown to or e-mailed to the contact; "visible_note" is also visible to the contact in the portal, "reply" e-mails the contact and sets the ticket to waiting for reply, "reply_and_close" e-mails the contact and closes the ticket. Always show the text and get explicit confirmation from the user before sending a reply to the contact. Do not add a signature, Inserve adds it.',
            annotations: WRITE,
            inputSchema: {
                ticket_id: z.number().int().min(1),
                message: z.string().min(1).max(20000).describe('The message, plain text.'),
                type: z.enum(Object.keys(MESSAGE_ACTIONS)).default('internal_note'),
            },
            async handler({ ticket_id, message, type = 'internal_note' }) {
                const created = await api.post('messages', {
                    morphable_type: 'tickets',
                    morphable_id: ticket_id,
                    message: plainTextToHtml(message),
                    action: MESSAGE_ACTIONS[type],
                });

                return presentMessage(created);
            },
        },
        {
            name: 'update_ticket',
            title: 'Ticket wijzigen',
            write: true,
            description: 'Change the subject, status, priority, ticket type or assigned operator of a ticket. Only the given fields are changed. Use list_lookups for the ids. Closing a ticket may e-mail the contact.',
            annotations: { ...WRITE, idempotentHint: true },
            inputSchema: {
                ticket_id: z.number().int().min(1),
                subject: z.string().min(1).max(255).optional(),
                status_id: z.number().int().optional(),
                priority_id: z.number().int().optional(),
                ticket_type_id: z.number().int().optional(),
                operator_id: z.number().int().optional(),
            },
            async handler({ ticket_id, subject, ...fields }) {
                const changes = withoutEmpty({ description: subject, ...fields });

                if (Object.keys(changes).length === 0) {
                    throw new Error('Geef minimaal één veld op om te wijzigen.');
                }

                await api.put(`tickets/${ticket_id}`, changes);

                return presentTicket(await api.get(`tickets/${ticket_id}`, {
                    load: ['status', 'priority', 'company', 'client', 'operator'],
                }));
            },
        },
        {
            name: 'set_ticket_categories',
            title: 'Categorieën van ticket wijzigen',
            write: true,
            description: 'Add and/or remove categories on a ticket. Categories that are not mentioned stay as they are. Use list_lookups (ticket_categories) for the ids.',
            annotations: { ...WRITE, idempotentHint: true },
            inputSchema: {
                ticket_id: z.number().int().min(1),
                add: z.array(z.number().int().min(1)).optional().describe('Category ids to add.'),
                remove: z.array(z.number().int().min(1)).optional().describe('Category ids to remove.'),
            },
            async handler({ ticket_id, add = [], remove = [] }) {
                if (add.length === 0 && remove.length === 0) {
                    throw new Error('Geef minimaal één categorie op om toe te voegen of te verwijderen.');
                }

                const conflicting = add.filter(id => remove.includes(id));
                if (conflicting.length > 0) {
                    throw new Error(`Categorie ${conflicting.join(', ')} staat zowel bij toevoegen als bij verwijderen.`);
                }

                const ticket = await api.get(`tickets/${ticket_id}`, { load: ['categories'] });
                const current = (ticket.categories ?? []).map(category => category.id);

                // Only ticket categories may be linked, unknown ids or asset categories would corrupt the ticket.
                if (add.length > 0) {
                    const existing = await api.get('categories', {
                        builder: [{ where: ['type', CATEGORY_TYPE_TICKET] }, { whereIn: ['id', add] }, { limit: add.length }],
                    });
                    const existingIds = (existing ?? []).map(category => category.id);
                    const unknown = add.filter(id => !existingIds.includes(id));

                    if (unknown.length > 0) {
                        throw new Error(`Onbekende ticketcategorie: ${unknown.join(', ')}. Gebruik list_lookups voor de juiste ids.`);
                    }
                }

                const next = [...new Set([...current, ...add])].filter(id => !remove.includes(id));
                const unchanged = next.length === current.length && next.every(id => current.includes(id));

                if (!unchanged) {
                    await api.put(`tickets/${ticket_id}`, { relationships: { categories: { sync: next } } });
                }

                const updated = unchanged ? ticket : await api.get(`tickets/${ticket_id}`, { load: ['categories'] });

                return {
                    id: updated.id,
                    reference: updated.reference,
                    subject: updated.description,
                    changed: !unchanged,
                    categories: presentCategories(updated.categories),
                };
            },
        },
        {
            name: 'log_time',
            title: 'Tijd registreren',
            write: true,
            description: 'Register time spent on a ticket for the user of the API key. Use list_lookups for the activity ids.',
            annotations: WRITE,
            inputSchema: {
                ticket_id: z.number().int().min(1),
                minutes: z.number().int().min(1).max(1440),
                activity_id: z.number().int().optional(),
                description: z.string().max(5000).optional().describe('What was done.'),
                executed_at: z.string().optional().describe('When the work was done (YYYY-MM-DD HH:MM), defaults to now.'),
            },
            async handler({ ticket_id, minutes, activity_id, description, executed_at }) {
                const timeRegistration = await api.post('time-registrations', withoutEmpty({
                    morphable_type: 'tickets',
                    morphable_id: ticket_id,
                    time_spent: minutes,
                    activity_id,
                    description,
                    executed_at: toDateTime(executed_at ?? new Date()),
                }));

                return presentTimeRegistration(timeRegistration);
            },
        },
    ];
}

function withoutEmpty(object) {
    return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
}

/**
 * Format a date as `Y-m-d H:i:s` in local time, the format Inserve stores.
 */
export function toDateTime(value) {
    // A date without time is parsed as UTC by JavaScript, so read it as local midnight instead.
    const text = String(value).trim();
    const date = value instanceof Date
        ? value
        : new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text.replace(' ', 'T'));

    if (Number.isNaN(date.getTime())) {
        throw new Error(`Ongeldige datum: ${value}`);
    }

    const pad = number => String(number).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
