# Inserve-MCP

Koppel je AI-assistent aan je Inserve-omgeving. Daarna kun je bijvoorbeeld vragen:

- *"Welke tickets staan er open bij Acme?"*
- *"Vat ticket T-1234 samen en zet er een interne notitie bij dat ik de klant heb gebeld."*
- *"Registreer 30 minuten op dat ticket voor het inrichten van de laptop."*

De assistent werkt met de rechten van de gebruiker bij je API-key. Wat die gebruiker in Inserve niet mag zien of doen, kan de assistent ook niet.

## Wat kan het?

| Tool | Wat het doet |
|---|---|
| `search_tickets` | Tickets zoeken op tekst, status, prioriteit, relatie of behandelaar |
| `get_ticket` | Een ticket bekijken met berichten en uren |
| `search_companies` / `get_company` | Relaties zoeken en bekijken |
| `search_contacts` | Contactpersonen zoeken |
| `search_assets` | Assets zoeken |
| `list_time_registrations` | Tijdregistraties bekijken |
| `list_lookups` | Statussen, prioriteiten, tickettypes, ticketcategorieën, activiteiten en behandelaars |
| `create_ticket` | Een ticket aanmaken |
| `add_ticket_message` | Een verborgen notitie (alleen voor behandelaars), zichtbare notitie of reactie aan de klant plaatsen |
| `update_ticket` | Onderwerp, status, prioriteit, type of behandelaar wijzigen |
| `set_ticket_categories` | Categorieën aan een ticket toevoegen of eraf halen |
| `log_time` | Tijd registreren op een ticket |

De laatste vijf tools passen gegevens aan. Zet **alleen lezen** aan als je die niet wilt gebruiken.

## Voordat je begint

1. **Maak een API-key aan in Inserve.** De assistent krijgt alle rechten van de gebruiker bij die key. Gebruik daarom bij voorkeur een aparte gebruiker met alleen de rechten die je de assistent wilt geven.
2. **Zoek het API-adres van je omgeving op**, bijvoorbeeld `https://jouwbedrijf.inserve-api.nl`.

## Installatie

### Claude Desktop (aanbevolen)

1. Download [`inserve-mcp.mcpb`](https://github.com/inserveit/inserve-mcp/releases/latest/download/inserve-mcp.mcpb) bij de [nieuwste release](https://github.com/inserveit/inserve-mcp/releases/latest).
2. Dubbelklik op het bestand, of sleep het naar Claude Desktop (*Instellingen → Extensies*).
3. Vul je API-adres en API-key in, en kies of je alleen lezen wilt.

Je hebt hiervoor geen Node.js nodig. Een nieuwe versie installeer je op dezelfde manier; je instellingen blijven bewaard.

### Claude Code

Hiervoor heb je Node.js 20 of nieuwer nodig.

```bash
claude mcp add inserve-mcp --scope user --env INSERVE_URL=https://jouwbedrijf.inserve-api.nl --env INSERVE_API_KEY=jouw-api-key -- npx -y github:inserveit/inserve-mcp
```

### Andere MCP-clients (Cursor, Claude Desktop handmatig, ...)

Hiervoor heb je Node.js 20 of nieuwer nodig. Zet dit in de MCP-configuratie van je client:

```json
{
  "mcpServers": {
    "inserve-mcp": {
      "command": "npx",
      "args": ["-y", "github:inserveit/inserve-mcp"],
      "env": {
        "INSERVE_URL": "https://jouwbedrijf.inserve-api.nl",
        "INSERVE_API_KEY": "jouw-api-key"
      }
    }
  }
}
```

## Instellingen

| Variabele | Verplicht | Uitleg |
|---|---|---|
| `INSERVE_URL` | ja | API-adres van je Inserve-omgeving |
| `INSERVE_API_KEY` | ja | API-key uit Inserve |
| `INSERVE_READ_ONLY` | nee | `true` toont alleen de tools die lezen |
| `INSERVE_ALLOW_SELF_SIGNED` | nee | Alleen voor lokale ontwikkeling: zet de certificaatcontrole uit |

## Goed om te weten

- **Reacties naar klanten:** een reactie van het type `reply` of `reply_and_close` wordt echt naar de klant gemaild. De assistent is geïnstrueerd om eerst de tekst te laten zien en om bevestiging te vragen. Controleer de tekst altijd.
- **Limieten:** API-verzoeken vallen onder de limiet van je Inserve-omgeving. Een assistent die veel opzoekt, telt daarin mee.
- **Je API-key:** die staat lokaal in de configuratie van je AI-client. Bewaar hem net zo zorgvuldig als een wachtwoord. Je kunt hem altijd intrekken in Inserve.

## Ontwikkelen

```bash
npm install
npm test
npm run pack:mcpb   # bouwt inserve-mcp.mcpb voor Claude Desktop
```

Lokaal testen tegen een ontwikkelomgeving met een self-signed certificaat:

```bash
INSERVE_URL=https://jouwtenant.inserve.loc:8080/api INSERVE_API_KEY=... INSERVE_ALLOW_SELF_SIGNED=true npx @modelcontextprotocol/inspector node src/index.js
```
