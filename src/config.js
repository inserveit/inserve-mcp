/**
 * Read and validate the configuration from environment variables.
 */
export function loadConfig(env = process.env) {
    const url = (env.INSERVE_URL ?? '').trim().replace(/\/+$/, '');
    const apiKey = (env.INSERVE_API_KEY ?? '').trim();

    const errors = [];

    if (!url) {
        errors.push('INSERVE_URL ontbreekt, bijvoorbeeld https://jouwbedrijf.inserve-api.nl');
    } else if (!/^https?:\/\//.test(url)) {
        errors.push('INSERVE_URL moet een volledig adres zijn dat begint met https://');
    }

    if (!apiKey) {
        errors.push('INSERVE_API_KEY ontbreekt. Maak een API-key aan in Inserve onder je profiel.');
    }

    if (errors.length > 0) {
        throw new Error(`Inserve MCP server is niet goed geconfigureerd:\n- ${errors.join('\n- ')}`);
    }

    return {
        url,
        apiKey,
        readOnly: isTrue(env.INSERVE_READ_ONLY),
        allowSelfSigned: isTrue(env.INSERVE_ALLOW_SELF_SIGNED),
    };
}

function isTrue(value) {
    return ['1', 'true', 'yes', 'ja'].includes(String(value ?? '').trim().toLowerCase());
}
