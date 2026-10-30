import { convert } from 'html-to-text';

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Lines that usually start a signature or a quoted e-mail.
 */
const CUTOFF_MARKERS = [
    /^met vriendelijke groet/i,
    /^vriendelijke groet/i,
    /^kind regards/i,
    /^best regards/i,
    /^groet,?$/i,
    /^gr\.?,?$/i,
    /^on .+ wrote:$/i,
    /^op .+ schreef .+:$/i,
    /^-----original message-----/i,
    /^van: /i,
    /^from: /i,
    /^sent from /i,
    /^verzonden vanaf /i,
];

/**
 * Message HTML to plain text, without images, signatures and quoted e-mails.
 */
export function htmlToPlainText(html) {
    if (!html) {
        return '';
    }

    const text = convert(html, {
        wordwrap: false,
        selectors: [
            { selector: 'img', format: 'skip' },
            { selector: 'map', format: 'skip' },
            { selector: 'a', options: { ignoreHref: true } },
            { selector: 'table', format: 'dataTable' },
            { selector: 'head', format: 'skip' },
            { selector: 'style', format: 'skip' },
            { selector: '#Signature', format: 'skip' },
            { selector: '#appendonsend', format: 'skip' },
            { selector: '#divRplyFwdMsg', format: 'skip' },
            { selector: '.gmail_signature', format: 'skip' },
            { selector: '.gmail_quote', format: 'skip' },
            { selector: 'blockquote', format: 'skip' },
        ],
    });

    const lines = text.split('\n').map(line => line.trim());
    const cutAt = lines.findIndex((line, index) => index > 0 && CUTOFF_MARKERS.some(re => re.test(line)));
    const kept = (cutAt === -1 ? lines : lines.slice(0, cutAt))
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    return kept.length > MAX_MESSAGE_LENGTH ? `${kept.slice(0, MAX_MESSAGE_LENGTH)}… [ingekort]` : kept;
}

/**
 * Plain text from the model to the HTML Inserve stores for messages.
 */
export function plainTextToHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\r?\n/g, '<br />\n');
}

export function fullName(user) {
    if (!user || typeof user !== 'object') {
        return null;
    }

    const name = [user.first_name, user.prefix, user.last_name].filter(Boolean).join(' ').trim();

    return name || user.full_name || user.email || null;
}

export function presentTicket(ticket) {
    return {
        id: ticket.id,
        reference: ticket.reference,
        subject: ticket.description,
        status: ticket.status?.name ?? null,
        status_id: ticket.status_id,
        priority: ticket.priority?.label ?? null,
        priority_id: ticket.priority_id,
        company: ticket.company?.name ?? null,
        company_id: ticket.company_id,
        contact: fullName(ticket.client),
        contact_id: ticket.client_id,
        operator: fullName(ticket.operator),
        operator_id: ticket.operator_id,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
    };
}

export function presentMessage(message) {
    return {
        id: message.id,
        author: fullName(message.actor) ?? message.original_email_from_name ?? null,
        is_from_contact: Boolean(message.is_from_client),
        sent_to_contact: Boolean(message.send_to_client),
        visible_to_contact: Boolean(message.visible_to_client),
        message: htmlToPlainText(message.message),
        created_at: message.created_at,
    };
}

export function presentTimeRegistration(timeRegistration) {
    return {
        id: timeRegistration.id,
        ticket_id: String(timeRegistration.morphable_type ?? '').endsWith('Ticket') ? timeRegistration.morphable_id : null,
        operator: fullName(timeRegistration.actor),
        activity: timeRegistration.activity?.name ?? null,
        minutes: timeRegistration.time_spent,
        description: timeRegistration.description ?? null,
        executed_at: timeRegistration.executed_at,
        invoiced: Boolean(timeRegistration.invoice_id),
    };
}

export function presentCompany(company) {
    return {
        id: company.id,
        name: company.name,
        email: company.email ?? null,
        telephone: company.telephone ?? null,
        postal_code: company.postal_code ?? null,
        city: company.city ?? null,
        debtor_code: company.debtor_code ?? null,
        archived: Boolean(company.archived_at),
    };
}

export function presentContact(contact) {
    return {
        id: contact.id,
        name: fullName(contact),
        email: contact.email ?? null,
        telephone: contact.telephone ?? null,
        telephone_cell: contact.telephone_cell ?? null,
        companies: (contact.companies ?? []).map(company => ({ id: company.id, name: company.name })),
    };
}

export function presentAsset(asset) {
    return {
        id: asset.id,
        name: asset.name,
        serial_number: asset.serial_number ?? null,
        status: asset.status?.name ?? null,
        company: asset.company?.name ?? null,
        company_id: asset.company_id,
        contact: fullName(asset.client),
        warranty_until: asset.warranty_until ?? null,
    };
}

export function presentCategories(categories) {
    return (categories ?? []).map(category => ({ id: category.id, name: category.title ?? category.name ?? null }));
}

export function presentPage(paginated, present) {
    return {
        items: (paginated?.data ?? []).map(present),
        page: paginated?.current_page ?? 1,
        last_page: paginated?.last_page ?? 1,
        total: paginated?.total ?? (paginated?.data ?? []).length,
    };
}
