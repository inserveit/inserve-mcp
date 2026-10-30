/**
 * Small client for the Inserve REST API, authenticated with an API key.
 */
export class InserveClient {
    /**
     * @param {{ url: string, apiKey: string }} config
     * @param {typeof fetch} fetchImpl
     */
    constructor(config, fetchImpl = fetch) {
        this.url = config.url;
        this.apiKey = config.apiKey;
        this.fetch = fetchImpl;
    }

    get(path, query = {}) {
        return this.request('GET', path, { query });
    }

    post(path, body) {
        return this.request('POST', path, { body });
    }

    put(path, body) {
        return this.request('PUT', path, { body });
    }

    async request(method, path, { query = {}, body } = {}) {
        const queryString = toQueryString(query);
        const url = `${this.url}/${path.replace(/^\/+/, '')}${queryString ? `?${queryString}` : ''}`;

        let response;
        try {
            response = await this.fetch(url, {
                method,
                headers: {
                    'X-Api-Key': this.apiKey,
                    Accept: 'application/json',
                    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        } catch (error) {
            throw new Error(`Kan Inserve niet bereiken op ${this.url}: ${error.cause?.message ?? error.message}`);
        }

        const text = await response.text();
        const data = text ? safeJson(text) : null;

        if (!response.ok) {
            throw new Error(errorMessage(response.status, data, text));
        }

        return data;
    }
}

/**
 * Encode nested objects and arrays the way Laravel/PHP expects them: b[0][whereIn][1][0]=3
 */
export function toQueryString(value, prefix = '') {
    const parts = [];

    const add = (key, val) => {
        if (val === undefined || val === null) {
            return;
        }

        if (typeof val === 'object') {
            for (const [childKey, childValue] of Object.entries(val)) {
                add(`${key}[${childKey}]`, childValue);
            }
            return;
        }

        if (typeof val === 'boolean') {
            val = val ? 1 : 0;
        }

        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
    };

    for (const [key, val] of Object.entries(value)) {
        add(prefix ? `${prefix}[${key}]` : key, val);
    }

    return parts.join('&');
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function errorMessage(status, data, text) {
    const message = stripTags(data?.message);
    const validation = data?.errors ? stripTags(Object.values(data.errors).flat().join(' ')) : '';

    if (status === 401) {
        return 'Inserve weigert de API-key (401). Controleer of de key klopt, niet verlopen is en of de gebruiker actief is.';
    }

    if (status === 403) {
        return `Geen rechten voor deze actie in Inserve (403)${message ? `: ${message}` : ''}.`;
    }

    if (status === 404) {
        return 'Niet gevonden in Inserve (404). Controleer het id, of INSERVE_URL als dit bij elke actie gebeurt.';
    }

    if (status === 429) {
        return 'Te veel verzoeken naar Inserve (429). Wacht even en probeer het opnieuw.';
    }

    const details = [message, validation].filter(Boolean).join(' ');

    return `Inserve gaf een fout (${status})${details ? `: ${details}` : text ? `: ${stripTags(text).slice(0, 300)}` : ''}`;
}

/**
 * Some Inserve error messages contain HTML, like `<br/>`.
 */
function stripTags(value) {
    return typeof value === 'string' ? value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : value;
}
