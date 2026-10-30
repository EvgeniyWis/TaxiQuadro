import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Минимальный разбор .env (без внешних зависимостей). Уже заданные переменные окружения не трогаем. */
const loadEnv = (file) => {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
        if (!m || line.trim().startsWith('#')) continue;
        let value = m[2];
        if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
        if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
};

loadEnv(path.join(ROOT, '.env'));

const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
    port: Number(env.PORT) || 3000,
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === '1',
    allowedOrigin: env.ALLOWED_ORIGIN || '',

    telegram: {
        token: env.TELEGRAM_BOT_TOKEN || '',
        // Чаты/группы/пользователи, куда летят заявки (через запятую)
        chatIds: list(env.TELEGRAM_CHAT_IDS || env.TELEGRAM_CHAT_ID),
        api: (env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, ''),
        polling: env.TELEGRAM_POLLING !== '0',
    },

    openai: {
        key: env.OPENAI_API_KEY || '',
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        baseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    },

    contacts: {
        phone1: '+7 952 353-45-45',
        phone2: '+7 952 369-90-49',
        email: 'Pro100iBusines@gmail.com',
    },
};
