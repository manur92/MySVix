import * as cheerio from 'cheerio';
import { request } from 'undici';
import { config } from './config';
import { makeProxyToken, VIXSRC_HEADERS } from './proxy';

export async function getVixSrcStreams(tmdbId: string, season?: string, episode?: string): Promise<{name: string, title: string, url: string}[]> {
    try {
        const siteOrigin = `https://${config.vixsrcDomain}`;
        let url = "";

        if (season && episode) {
             url = `${siteOrigin}/tv/${tmdbId}/${season}/${episode}/`;
        } else {
             url = `${siteOrigin}/movie/${tmdbId}/`;
        }
        
        console.log("Checking VixSrc URL:", url);

        const checkRes = await request(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0 (StreamViX EarlyDirect)' } });
        if (checkRes.statusCode !== 200 && checkRes.statusCode !== 301 && checkRes.statusCode !== 302) {
             console.log(`VixSrc content not found: ${url} (status: ${checkRes.statusCode})`);
             return [];
        }

        const { body, statusCode } = await request(url);
        if (statusCode !== 200) throw new Error(`Fetch fail: ${statusCode}`);
        const pageHtml = await body.text();

        const $ = cheerio.load(pageHtml);
        const scriptTag = $("body script").filter((_, el) => {
            const htmlContent = $(el).html();
            return !!htmlContent && htmlContent.includes("'token':") && htmlContent.includes("'expires':");
        }).first();
        const scriptContent = scriptTag.html() || '';

        if (!scriptContent) throw new Error("Player script with token/expires not found.");

        const tokenMatch = scriptContent.match(/'token':\s*'(\w+)'/);
        const expiresMatch = scriptContent.match(/'expires':\s*'(\d+)'/);
        const serverUrlMatch = scriptContent.match(/url:\s*'([^']+)'/);

        if (!tokenMatch || !expiresMatch || !serverUrlMatch) {
            throw new Error("Failed to extract token, expires, or server URL from script.");
        }

        let finalStreamUrl = serverUrlMatch[1] || "";
        if (finalStreamUrl.includes("?b:1")) {
            finalStreamUrl = finalStreamUrl.replace("?b:1", "?b=1");
        }
        const hasQuery = finalStreamUrl.includes("?");
        finalStreamUrl += `${hasQuery ? "&" : "?"}token=${tokenMatch[1]}&expires=${expiresMatch[1]}&h=1`;
        
        // Ensure .m3u8
        const urlObj = new URL(finalStreamUrl);
        const parts = urlObj.pathname.split('/');
        const pIdx = parts.indexOf('playlist');
        if (pIdx !== -1 && pIdx < parts.length - 1) {
            let nextPart = parts[pIdx + 1];
            if (nextPart && !nextPart.includes('.')) {
                parts[pIdx + 1] = nextPart + '.m3u8';
                urlObj.pathname = parts.join('/');
                finalStreamUrl = urlObj.toString();
            }
        }

        console.log(`[VixSrc] Raw stream URL: ${finalStreamUrl}`);

        // Wrap through local HLS proxy so the server IP fetches all segments
        const proxyToken = makeProxyToken(finalStreamUrl, VIXSRC_HEADERS);

        return [{
            name: "SC 🤌",
            title: "VIX 1080 🤌",
            url: `/proxy/hls/manifest.m3u8?token=${proxyToken}`
        }];

    } catch(err) {
        console.error("VixSrc Stream extraction error", err);
        return [];
    }
}
