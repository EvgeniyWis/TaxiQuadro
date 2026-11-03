/**
 * «Мост» до Telegram для хостинга, который не достаёт до api.telegram.org.
 * Запускается как Cloudflare Worker (бесплатно). Инструкция — в README, раздел «Telegram через Cloudflare».
 *
 * Секрет RELAY_KEY (Settings → Variables and Secrets) должен совпадать с telegram_relay_key в lead-config.php.
 * Мост пересылает только POST /bot<token>/sendMessage и только тем, кто знает ключ.
 */
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (request.method !== 'POST' || !/^\/bot[^/]+\/sendMessage$/.test(url.pathname)) {
            return new Response('Not found', { status: 404 });
        }
        if (!env.RELAY_KEY || request.headers.get('X-Relay-Key') !== env.RELAY_KEY) {
            return new Response('Forbidden', { status: 403 });
        }

        const resp = await fetch(`https://api.telegram.org${url.pathname}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: request.body,
        });
        return new Response(resp.body, { status: resp.status, headers: { 'Content-Type': 'application/json' } });
    },
};
