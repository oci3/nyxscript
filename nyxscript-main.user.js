// ==UserScript==
// @name         nyxscript
// @namespace    https://github.com/oci3/nyxscript
// @version      15.2.2
// @description  cipher for discord text + AES-GCM files + fake profiles with a drag-to-position editor. right shift opens settings ui, alt+n toggles on/off.
// @author       oci3
// @match        https://discord.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @connect      cdn.discordapp.com
// @connect      media.discordapp.net
// @connect      i.imgur.com
// @connect      files.catbox.moe
// @connect      tenor.com
// @connect      *
// @run-at       document-start
// @downloadURL https://github.com/oci3/nyxscript/raw/refs/heads/main/nyxscript-main.user.js
// @updateURL https://github.com/oci3/nyxscript/raw/refs/heads/main/nyxscript-main.user.js
// ==/UserScript==

(function () {
    'use strict';
    const W = unsafeWindow;

    // ─── Config ───────────────────────────────────────────────────────────────
    const PASSPHRASE = 'change-me-and-share-with-friends';
    const SALT = 'nyxscript-v10';
    const CFG_KEY = 'nyxscript_cfg';

    // position triples: banner/avatar = [x%, y%, zoom%], decoration = [dx% of avatar, dy% of avatar, scale%]
    const BP = [50, 50, 100], AP = [50, 50, 100], DP = [0, 0, 120];

    const D = {
        auto: false,  // start enabled on page load
        debug: false, // console logging
        known: {},    // profile payloads seen before: userId -> payload
        hide: false,  // remove normal (non-encrypted) messages + files from view
        lib: [],      // saved emojis / stickers: { n:name, t:'e'|'s'|'u', id, x:ext }
        prof: { c: false, c1: '#5865f2', c2: '#eb459e', b: '', d: '', a: '', bp: BP.slice(), ap: AP.slice(), dp: DP.slice() },
        enc:   { fg: '#57f287', bg: '#000000', ba: 0,  op: 100 },
        plain: { fg: '#dbdee1', bg: '#000000', ba: 0,  op: 100 },
        file:  { fg: '#57f287', bg: '#000000', ba: 40, op: 100 }
    };
    let cfg = JSON.parse(JSON.stringify(D));
    try {
        let raw = null;
        try { raw = GM_getValue(CFG_KEY, null); } catch (e) {}
        if (!raw) { try { raw = localStorage.getItem(CFG_KEY); } catch (e) {} }
        const s = JSON.parse(raw);
        if (s) for (const k in s) cfg[k] = (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) ? { ...cfg[k], ...s[k] } : s[k];
    } catch (e) {}
    for (const [k, d] of [['bp', BP], ['ap', AP], ['dp', DP]]) {
        if (!Array.isArray(cfg.prof[k]) || cfg.prof[k].length !== 3) cfg.prof[k] = d.slice();
    }
    const save = () => { try { GM_setValue(CFG_KEY, JSON.stringify(cfg)); } catch (e) { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e2) {} } };
    const log = (...a) => { if (cfg.debug) console.log('[opsec]', ...a); };

    let enabled = !!cfg.auto; // off by default (Alt+N toggles)
    const sent = new Set(), orig = new WeakMap();
    let tk = 0;

    const tag = x => Object.prototype.toString.call(x);
    const isFormData = x => tag(x) === '[object FormData]';
    const isBlob = x => tag(x) === '[object Blob]' || tag(x) === '[object File]';
    const el = (t, p = {}, ...c) => { const e = document.createElement(t); Object.assign(e, p); e.append(...c); return e; };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

    // ─── Text cipher ──────────────────────────────────────────────────────────
    const ENCODE_MAP = {
        a:"꩜",b:"ꫂ",c:"꩟",d:"ꪾ",e:"ꩠ",f:"ꫛ",g:"ꩡ",h:"ꪽ",
        i:"ꩢ",j:"ꫜ",k:"ꩣ",l:"ꪼ",m:"ꩤ",n:"ꫝ",o:"ꩥ",p:"ꪻ",
        q:"ꩦ",r:"꫞",s:"ꩧ",t:"ꪺ",u:"ꩨ",v:"꫟",w:"ꩩ",x:"ꪹ",
        y:"ꩪ",z:"ꫠ",
        A:"ꩫ",B:"ꪸ",C:"ꩬ",D:"ꫡ",E:"ꩭ",F:"ꪷ",G:"ꩮ",H:"ꫢ",
        I:"ꩯ",J:"ꪶ",K:"ꩰ",L:"ꫣ",M:"ꩱ",N:"ꪵ",O:"ꩲ",P:"ꫤ",
        Q:"ꩳ",R:"ꪴ",S:"ꩴ",T:"ꫥ",U:"ꩵ",V:"ꪳ",W:"ꩶ",X:"ꫦ",
        Y:"꩷",Z:"ꪲ",
        "0":"꩸","1":"ꫧ","2":"꩹","3":"ꪱ","4":"ꩺ","5":"ꫨ",
        "6":"ꩻ","7":"ꪰ","8":"ꩼ","9":"ꫩ"
    };
    const DECODE_MAP = Object.fromEntries(Object.entries(ENCODE_MAP).map(([k, v]) => [v, k]));

    const PT = '(<[^>\\s]+>|https?:\\/\\/\\S+|@everyone|@here)';
    const PASSTHROUGH = new RegExp(PT), PASSTHROUGH_G = new RegExp(PT, 'g');

    const encode = t => t.split(PASSTHROUGH)
        .map((p, i) => (i % 2 ? p : [...expand(p)].map(c => ENCODE_MAP[c] ?? c).join(''))).join('');
    const decode = t => [...t].map(c => DECODE_MAP[c] ?? c).join('');

    // library :name: -> invisible-to-others marker, e.g. {nyx|e|ID|webp}. goes through the cipher too.
    function expand(p) {
        return p.replace(/:(\w{2,32}):/g, (m, nm) => {
            const e = cfg.lib.find(x => x.n.toLowerCase() === nm.toLowerCase());
            return e ? (e.t === 'u' ? `{nyx|u|${e.id}}` : `{nyx|${e.t}|${e.id}|${e.x}}`) : m;
        });
    }

    function looksEncoded(text) {
        const chars = [...text.replace(PASSTHROUGH_G, '')].filter(c => c.trim() && !/[.,!?;:'"(){}|\-\s]/.test(c));
        return chars.length > 0 && chars.filter(c => DECODE_MAP[c]).length / chars.length > 0.5;
    }

    // ─── File crypto (AES-GCM, PBKDF2 key) ────────────────────────────────────
    const OVERHEAD = 28;
    let keyPromise = null;
    function getKey() {
        if (!keyPromise) {
            const enc = new TextEncoder();
            keyPromise = crypto.subtle.importKey('raw', enc.encode(PASSPHRASE), 'PBKDF2', false, ['deriveKey'])
                .then(base => crypto.subtle.deriveKey(
                    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 100000, hash: 'SHA-256' },
                    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
        }
        return keyPromise;
    }
    async function encryptBytes(buf) {
        const key = await getKey(), iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buf));
        const out = new Uint8Array(12 + ct.length);
        out.set(iv, 0); out.set(ct, 12);
        return out;
    }
    async function decryptBytes(buf) {
        const u = new Uint8Array(buf), key = await getKey();
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, key, u.slice(12));
    }

    const NYX_NAME = /nyx-([a-z0-9]{1,5})\.nyx$/i;
    function cloakName(name) {
        const m = /\.([a-z0-9]{1,5})$/i.exec(name || '');
        return `${/^SPOILER_/.test(name || '') ? 'SPOILER_' : ''}nyx-${m ? m[1].toLowerCase() : 'bin'}.nyx`;
    }
    const MIME = {
        png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp',
        avif:'image/avif', bmp:'image/bmp', mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime',
        mp3:'audio/mpeg', mpeg:'audio/mpeg', mpga:'audio/mpeg', ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg',
        wav:'audio/wav', flac:'audio/flac', m4a:'audio/mp4', aac:'audio/aac'
    };

    // detect the real audio format from the decrypted bytes, so a wrong/odd extension still plays
    function sniffExt(buf, ext) {
        const u = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
        const s = String.fromCharCode(...u);
        if (s.startsWith('ID3') || (u[0] === 0xFF && (u[1] & 0xE0) === 0xE0)) return 'mp3';
        if (s.startsWith('OggS')) return 'ogg';
        if (s.startsWith('fLaC')) return 'flac';
        if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'wav';
        return ext;
    }
    // detect the real image format (urls without an extension, wrong extensions)
    function sniffImg(buf) {
        const u = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
        const s = String.fromCharCode(...u);
        if (s.startsWith('GIF8')) return 'image/gif';
        if (u[0] === 0x89 && s.slice(1, 4) === 'PNG') return 'image/png';
        if (u[0] === 0xFF && u[1] === 0xD8) return 'image/jpeg';
        if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp';
        return null;
    }

    // ─── Outgoing ─────────────────────────────────────────────────────────────
    const MSG_URL = /\/channels\/\d+\/messages(\/\d+)?(\?|$)/;
    const ATTACH_URL = /\/channels\/\d+\/attachments(\?|$)/;
    const UPLOAD_URL = /storage\.googleapis\.com/;
    const shouldRewrite = (url, m) =>
        ((m === 'POST' || m === 'PATCH') && MSG_URL.test(url)) ||
        (m === 'POST' && ATTACH_URL.test(url)) ||
        (m === 'PUT' && UPLOAD_URL.test(url));

    function transformJson(body, url, method, isForm) {
        let json;
        try { json = JSON.parse(body); } catch (e) { return body; }
        let changed = false;
        if (method === 'POST' && ATTACH_URL.test(url)) {
            if (Array.isArray(json.files)) {
                json.files.forEach(f => {
                    f.filename = cloakName(f.filename);
                    if (typeof f.file_size === 'number') f.file_size += OVERHEAD;
                });
                changed = true;
            }
        } else if (MSG_URL.test(url)) {
            if (method === 'POST' && /^\d+$/.test(String(json.nonce))) {
                // our own pending message: style it as encrypted from the first frame
                sent.add(String(json.nonce));
                const pl = document.querySelector(`li[id$="-${json.nonce}"]`);
                if (pl) processLi(pl);
            }
            if (typeof json.content === 'string' && json.content.trim()) {
                // no looksEncoded() guard: cipher glyphs aren't in ENCODE_MAP so they pass through unchanged,
                // which means re-encoding is harmless and mixed cipher+plain text (edits) gets fully encrypted
                const enc = encode(json.content);
                if (enc !== json.content) { json.content = enc; changed = true; }
            }
            if (Array.isArray(json.attachments)) {
                json.attachments.forEach(a => {
                    if ((isForm || (a && a.uploaded_filename)) && typeof a.filename === 'string' && !NYX_NAME.test(a.filename)) {
                        a.filename = cloakName(a.filename); changed = true;
                    }
                });
            }
        }
        return changed ? JSON.stringify(json) : body;
    }

    async function transformForm(fd, url, method) {
        const out = new W.FormData();
        for (const [k, v] of fd.entries()) {
            if (k === 'payload_json' && typeof v === 'string') out.append(k, transformJson(v, url, method, true));
            else if (isBlob(v) && /^files\[/.test(k)) {
                const enc = await encryptBytes(await v.arrayBuffer());
                out.append(k, new W.Blob([enc], { type: 'application/octet-stream' }), cloakName(v.name));
            } else out.append(k, v);
        }
        return out;
    }

    async function rewriteBody(body, url, method) {
        if (typeof body === 'string') return transformJson(body, url, method, false);
        if (isFormData(body)) return transformForm(body, url, method);
        if (method === 'PUT' && UPLOAD_URL.test(url) && isBlob(body)) {
            return new W.Blob([await encryptBytes(await body.arrayBuffer())], { type: 'application/octet-stream' });
        }
        return body;
    }

    const origFetch = W.fetch;
    W.fetch = function (resource, config) {
        try {
            if (enabled && config && config.body != null) {
                const url = typeof resource === 'string' ? resource : (resource?.url || String(resource));
                const method = (config.method || 'GET').toUpperCase();
                if (shouldRewrite(url, method)) {
                    return rewriteBody(config.body, url, method)
                        .then(b => origFetch.call(W, resource, { ...config, body: b }))
                        .catch(err => { console.warn('[opsec] rewrite failed', err); return origFetch.call(W, resource, config); });
                }
            }
        } catch (e) { console.warn('[opsec] fetch hook error', e); }
        return sniff(resource, origFetch.call(W, resource, config));
    };

    const XHR = W.XMLHttpRequest.prototype, origOpen = XHR.open, origSend = XHR.send;
    XHR.open = function (method, url, ...rest) {
        this._nyx = { method: String(method).toUpperCase(), url: String(url) };
        return origOpen.call(this, method, url, ...rest);
    };
    XHR.send = function (body) {
        try {
            const m = this._nyx;
            if (m && m.method === 'GET' && PROFILE_URL.test(m.url)) {
                this.addEventListener('load', () => { try { readProfile(JSON.parse(this.responseText)); } catch (e) {} });
            }
            if (enabled && m && body != null && shouldRewrite(m.url, m.method)) {
                rewriteBody(body, m.url, m.method).catch(() => body).then(b => origSend.call(this, b));
                return;
            }
        } catch (e) { console.warn('[opsec] xhr hook error', e); }
        return origSend.call(this, body);
    };

    // ─── Styles ───────────────────────────────────────────────────────────────
    const rgba = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a / 100})`; };
    const BASE = `#nyx-gui{position:fixed;top:16px;right:72px;z-index:100000;width:240px;padding:10px;background:#111;color:#ddd;border:1px solid #333;font:12px monospace}
#nyx-gui *{border-radius:0!important;font:inherit}
#nyx-gui label{display:flex;justify-content:space-between;align-items:center;margin:5px 0}
#nyx-gui h4{margin:10px 0 2px;padding-top:6px;border-top:1px solid #333;color:#888;font-weight:400}
#nyx-gui input[type=color]{width:40px;height:18px;padding:0;border:1px solid #333;background:none}
#nyx-gui input[type=range]{width:110px}
#nyx-gui button{width:100%;margin-top:8px;padding:4px;background:#222;color:#ddd;border:1px solid #333;cursor:pointer}
#nyx-gui{max-height:calc(100vh - 32px);overflow:auto}
#nyx-gui label button{width:24px;margin:0;padding:1px}
#nyx-gui input[type=text]{width:130px;background:#222;color:#ddd;border:1px solid #333;padding:2px}
.nyx-emo{height:1.375em;width:auto;vertical-align:-.3em}
.nyx-emo.nyx-big{height:48px;vertical-align:middle}
.nyx-stk{display:block;height:160px;width:auto}
[class*="repliedTextContent"] .nyx-emo{height:1.1em;vertical-align:-.2em}
[class*="repliedTextContent"] .nyx-stk{display:inline;height:1.4em;vertical-align:-.3em}
#nyx-layer{position:fixed;inset:0;pointer-events:none;z-index:99998;overflow:hidden}
#nyx-layer .nyx-deco{position:absolute;left:0;top:0;display:none;pointer-events:none;transform-origin:0 0;will-change:transform}
#nyx-editor{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100001;width:344px;max-height:92vh;overflow:auto;padding:12px;background:#111;color:#ddd;border:1px solid #333;font:12px monospace;box-shadow:0 8px 40px rgba(0,0,0,.6)}
#nyx-editor *{font:inherit;box-sizing:border-box}
#nyx-editor h4{margin:12px 0 2px;padding-top:8px;border-top:1px solid #333;color:#aaa;font-weight:400}
#nyx-editor h4:first-of-type{margin-top:6px;border-top:0;padding-top:0}
#nyx-editor .nyx-hint{color:#777;margin-bottom:6px}
#nyx-editor .nyx-frame{position:relative;overflow:hidden;isolation:isolate;background:#222;outline:1px solid #444;cursor:grab;user-select:none;touch-action:none}
#nyx-editor .nyx-frame:active{cursor:grabbing}
#nyx-editor label{display:flex;justify-content:space-between;align-items:center;margin:6px 0 0}
#nyx-editor input[type=range]{width:200px}
#nyx-editor button{margin-top:6px;padding:4px 8px;background:#222;color:#ddd;border:1px solid #333;cursor:pointer}
#nyx-editor .nyx-done{width:100%;margin-top:14px}`;

    function css() {
        const A = 'html[data-nyx-on] ', M = '[id^="message-content-"]', { enc: e, plain: p, file: f } = cfg;
        const bx = x => `background:${rgba(x.bg, x.ba)};opacity:${x.op / 100}`;
        return BASE
            + `${A}[data-nyx-enc]{color:${e.fg}!important;${bx(e)}}`
            + `${A}${M}:not([data-nyx-enc]){${p.fg !== D.plain.fg ? `color:${p.fg}!important;` : ''}${bx(p)}}`
            + `${A}.nyx-file{display:block;width:fit-content;max-width:100%;padding:3px;border:2px solid ${f.fg};line-height:0;${bx(f)}}`
            + `html[data-nyx-on][data-nyx-hide] li[data-nyx-kind="plain"]{display:none!important}`;
    }

    const st = el('style');
    document.documentElement.append(st);
    function apply() {
        st.textContent = css();
        const h = document.documentElement;
        h.toggleAttribute('data-nyx-on', enabled);
        h.toggleAttribute('data-nyx-hide', cfg.hide);
    }
    apply();

    // ─── Incoming (processed synchronously in the observer = no visible flash) ─
    const MSG = '[id^="message-content-"], [class*="repliedTextContent"]';
    const LI = 'li[id^="chat-messages-"]';
    const AV_SEL = 'img[src*="/avatars/"], img[data-nyx-uid]';

    function gmGet(url) {
        return new Promise((res, rej) => GM_xmlhttpRequest({
            method: 'GET', url, responseType: 'arraybuffer', timeout: 25000,
            onload: r => (r.status >= 200 && r.status < 300) ? res(r.response) : rej(new Error('HTTP ' + r.status)),
            onerror: () => rej(new Error('network error')), ontimeout: () => rej(new Error('timeout'))
        }));
    }
    const mediaCache = new Map();
    // resolves { url, ext } where ext is the sniffed real extension
    function loadMedia(href, ext) {
        if (!mediaCache.has(href)) {
            mediaCache.set(href, gmGet(href).then(decryptBytes).then(b => {
                const x = sniffExt(b, ext);
                return { url: URL.createObjectURL(new Blob([b], { type: MIME[x] || 'application/octet-stream' })), ext: x };
            }).catch(e => { mediaCache.delete(href); throw e; }));
        }
        return mediaCache.get(href);
    }

    function renderMedia(url, ext) {
        const mime = MIME[ext] || '';
        let m;
        if (mime.startsWith('image/')) {
            m = el('img', { src: url }); m.style.cursor = 'zoom-in'; m.onclick = () => window.open(url, '_blank');
        } else if (mime.startsWith('video/')) {
            m = el('video', { src: url, controls: true });
        } else if (mime.startsWith('audio/')) {
            m = el('audio', { src: url, controls: true, preload: 'auto' });
            Object.assign(m.style, { display: 'block', width: '320px', maxWidth: '100%', height: '54px' });
            const dl = el('a', { href: url, download: 'audio.' + ext, textContent: 'download (.' + ext + ')' });
            Object.assign(dl.style, { display: 'block', color: '#00a8fc', lineHeight: 'normal', fontSize: '11px', marginTop: '2px' });
            return el('div', { className: 'nyx-file' }, m, dl);
        } else {
            m = el('a', { href: url, download: 'file.' + ext, textContent: 'download decrypted file (.' + ext + ')' });
            m.style.color = '#00a8fc'; m.style.lineHeight = 'normal';
        }
        Object.assign(m.style, { display: 'block', width: 'auto', height: 'auto', maxWidth: '400px', maxHeight: '350px' });
        return el('div', { className: 'nyx-file' }, m);
    }

    function findCard(a, acc) {
        let card = a;
        while (card.parentElement && card.parentElement !== acc) {
            const p = card.parentElement;
            if (new Set([...p.querySelectorAll('a[href*="/attachments/"]')].map(x => x.href)).size > 1) break;
            card = p;
        }
        return card;
    }

    // emoji-only message = jumbo (48px), like normal Discord
    function jumbo(e) {
        const imgs = e.querySelectorAll('img.nyx-emo');
        let only = false;
        if (imgs.length && imgs.length <= 30) {
            const c = e.cloneNode(true);
            c.querySelectorAll('img,time,[class*="timestamp"],[class*="edited"]').forEach(x => x.remove());
            only = !c.textContent.replace(/\s/g, '');
        }
        imgs.forEach(i => i.classList.toggle('nyx-big', only));
    }

    function decodeEl(e) {
        const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        let n, hit = false;
        while ((n = w.nextNode())) {
            if (!looksEncoded(n.nodeValue)) continue;
            const x = n.nextSibling;
            if (x && x.nodeType === 1 && x.hasAttribute('data-nyx-x')) x.remove(); // stale emoji span from a previous decode
            orig.set(n, n.nodeValue); n.nodeValue = decode(n.nodeValue); hit = true;
            emojify(n);
        }
        if (hit) {
            e.setAttribute('data-nyx-enc', '');
            if (e.id && e.id.startsWith('message-content-')) jumbo(e);
        }
    }

    // ── editing: discord puts the raw cipher into the edit box. swap it for readable text via a synthetic paste,
    //    so slate's own state updates; saving sends plain text and the fetch hook re-encrypts it.
    const EDITOR = '[data-slate-editor="true"], [role="textbox"][contenteditable="true"]';
    const unexpand = t => t.replace(/\{nyx\|(?:([es])\|(\d+)\|([a-z]{3,4})|u\|([\w:.\-\/]+))\}/g, (m, ty, id, x, ref) => {
        const e = cfg.lib.find(l => ref ? (l.t === 'u' && l.id === ref) : (l.t === ty && l.id === id));
        return e ? `:${e.n}:` : m;
    });
    const edText = ed => (ed.innerText || ed.textContent || '').replace(/[\u200b\ufeff]/g, '');
    // ONE method only (the old paste + insertText fallback could both fire = duplicated text), run once per edit session
    function fixEditor(ed) {
        const raw = edText(ed);
        if (!looksEncoded(raw)) return false;
        const lines = unexpand(decode(raw)).replace(/\n+$/, '').split('\n');
        setTimeout(() => {
            if (!ed.isConnected) return;
            ed.focus();
            document.execCommand('selectAll', false, null);
            lines.forEach((l, i) => { if (i) document.execCommand('insertLineBreak'); if (l) document.execCommand('insertText', false, l); });
        }, 60);
        return true;
    }

    function processLi(li) {
        const own = sent.has(li.id.split('-').pop());
        if (own) li.querySelectorAll('[id^="message-content-"]').forEach(c => c.setAttribute('data-nyx-enc', ''));
        li.querySelectorAll(MSG).forEach(decodeEl);
        let media = false;
        li.querySelectorAll('a[href*="/attachments/"]').forEach(a => {
            let m;
            try { m = NYX_NAME.exec(new URL(a.href).pathname); } catch (e) { return; }
            if (!m) return;
            media = true;
            if (a.closest('[data-nyx-media]')) return;
            const acc = a.closest('[id^="message-accessories-"]');
            if (!acc) return;
            const ext = m[1].toLowerCase(), card = findCard(a, acc);
            const tok = String(++tk);
            card.dataset.nyxMedia = tok;
            card.style.display = 'none'; // hide the .nyx card right away
            loadMedia(a.href, ext).then(r => {
                if (enabled && card.isConnected && card.dataset.nyxMedia === tok) card.parentElement.insertBefore(renderMedia(r.url, r.ext), card);
            }).catch(err => {
                if (card.dataset.nyxMedia === tok) card.style.display = '';
                console.warn('[opsec] could not decrypt attachment', err);
            });
        });
        if (profiles.size) li.querySelectorAll(AV_SEL).forEach(i => { avaReplace(i); trackImg(i); });
        const ed0 = li.querySelector(EDITOR);
        if (!ed0) delete li.dataset.nyxEdit;
        else if (!li.dataset.nyxEdit && fixEditor(ed0)) li.dataset.nyxEdit = '1';
        // a message being edited has no message-content element, which used to flag it "plain" and hide it
        const editing = !!li.querySelector(EDITOR);
        li.dataset.nyxKind = (own || media || editing || li.querySelector('[id^="message-content-"][data-nyx-enc]')) ? 'enc' : 'plain';
    }

    const scanAll = () => document.querySelectorAll(LI).forEach(processLi);

    // our own nodes never re-trigger the observer (that was the self-feeding loop in the old version)
    const OWN = '#nyx-gui,#nyx-editor,#nyx-layer,.nyx-cv,.nyx-file,[data-nyx-x]';
    const isOwn = n => { const e = n.nodeType === 1 ? n : n.parentElement; return !!(e && e.closest && e.closest(OWN)); };

    new MutationObserver(ms => {
        if (!enabled) return;
        const lis = new Set();
        let touched = false;
        const add = n => {
            if (!n || n.nodeType !== 1 || isOwn(n)) return;
            touched = true;
            const li = n.closest(LI);
            if (li) lis.add(li); else n.querySelectorAll(LI).forEach(x => lis.add(x));
        };
        for (const m of ms) {
            if (m.type === 'characterData') {
                const pe = m.target.parentElement;
                if (pe && !isOwn(pe)) { const li = pe.closest(LI); if (li) lis.add(li); }
            } else m.addedNodes.forEach(add);
        }
        lis.forEach(processLi);
        if (touched) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

    // ─── Gui helpers ──────────────────────────────────────────────────────────
    function revert() { // undo everything we did to the page
        document.querySelectorAll('img[data-nyx-oa]').forEach(avaRestore);
        decos.forEach(r => r.d.remove()); decos.clear();
        document.querySelectorAll('[data-nyx-x]').forEach(x => x.remove());
        document.querySelectorAll('.nyx-cv').forEach(x => { if (!x.closest('#nyx-editor')) x.remove(); });
        document.querySelectorAll('[data-nyx-bak]').forEach(x => { x.setAttribute('style', x.dataset.nyxBak); delete x.dataset.nyxBak; delete x.dataset.nyxTh; });
        document.querySelectorAll('[data-nyx-enc]').forEach(e => {
            const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = w.nextNode())) if (orig.has(n)) n.nodeValue = orig.get(n);
            e.removeAttribute('data-nyx-enc');
        });
        document.querySelectorAll('.nyx-file').forEach(x => x.remove());
        document.querySelectorAll('[data-nyx-media]').forEach(c => { c.style.display = ''; delete c.dataset.nyxMedia; });
        document.querySelectorAll('[data-nyx-kind]').forEach(l => delete l.dataset.nyxKind);
    }

    function setEnabled(v) {
        enabled = v;
        apply();
        const b = document.getElementById('nyx-en'); if (b) b.textContent = v ? 'on' : 'off';
        if (v) { scanAll(); applyProfiles(); } else revert();
    }

    // ─── Fake nitro emojis / stickers ─────────────────────────────────────────
    const MKG = /\{nyx\|(?:([es])\|(\d+)\|([a-z]{3,4})|u\|([\w:.\-\/]+))\}/g;
    function emojify(n) {
        const s = n.nodeValue, re = new RegExp(MKG.source, 'g');
        let m = re.exec(s);
        if (!m) return;
        const sp = el('span');
        sp.setAttribute('data-nyx-x', '');
        n.nodeValue = s.slice(0, m.index);
        while (m) {
            const em = m[4] || m[1] === 'e';
            const img = el('img', { draggable: false, className: em ? 'nyx-emo' : 'nyx-stk' });
            if (m[4]) { const ref = m[4]; refBlob(ref).then(u => { img.src = u; }).catch(e => console.warn('[opsec] emoji link failed', ref, e)); }
            else img.src = `https://cdn.discordapp.com/${m[1] === 'e' ? 'emojis' : 'stickers'}/${m[2]}.${m[3]}?size=${em ? 96 : 160}`;
            sp.append(img);
            const end = m.index + m[0].length, nx = re.exec(s);
            sp.append(s.slice(end, nx ? nx.index : s.length));
            m = nx;
        }
        n.after(sp);
    }

    function parseAsset(str, name) {
        const isUrl = /^https?:\/\//.test(str) || /^(i\.imgur\.com|files\.catbox\.moe)\//.test(str);
        if (isUrl && !/(emojis|stickers)\/\d+/.test(str)) return { t: 'u', id: shorten(str, true), x: '', n: name || '' };
        const m = /(emojis|stickers)\/(\d+)(?:\.(\w{3,4}))?/.exec(str) || (/^(\d{15,22})$/.exec(str) && [0, 'emojis', str]);
        if (!m) return null;
        const t = m[1] === 'emojis' ? 'e' : 's';
        let x = (m[3] || (t === 'e' ? 'webp' : 'png')).toLowerCase();
        if (t === 'e' && /animated=true/.test(str)) x = 'gif';
        return { t, id: m[2], x, n: name || (/[?&]name=(\w+)/.exec(str) || [])[1] || '' };
    }

    let libBox = null;
    function renderLib() {
        libBox.replaceChildren(...cfg.lib.map(e => el('label', {}, `:${e.n}: (${e.t === 'e' ? 'emoji' : e.t === 's' ? 'sticker' : 'link'})`,
            el('button', { textContent: 'x', onclick: () => { cfg.lib = cfg.lib.filter(y => y !== e); save(); renderLib(); } }))));
    }
    function addLib(a, nm) {
        nm = (nm || a.n || '').replace(/\W/g, '');
        if (!nm) return;
        cfg.lib = cfg.lib.filter(x => x.n.toLowerCase() !== nm.toLowerCase());
        cfg.lib.push({ ...a, n: nm }); save();
        if (libBox) renderLib();
    }
    function findAsset(e) {
        for (let i = 0; e && i < 5; i++, e = e.parentElement) {
            const s = (e.src || '') + (e.getAttribute ? e.getAttribute('style') || '' : '');
            if (/(emojis|stickers)\/\d+/.test(s)) return parseAsset(s);
        }
        return null;
    }
    document.addEventListener('click', ev => { // alt+click an emoji/sticker anywhere = save it
        if (!enabled || !ev.altKey) return;
        const a = findAsset(ev.target); if (!a) return;
        ev.preventDefault(); ev.stopPropagation();
        const nm = prompt('save to library as:', a.n || (a.t === 'e' ? 'emoji' : 'sticker') + a.id.slice(-4));
        if (nm) addLib(a, nm);
    }, true);

    // ─── Fake profiles: payload hidden in the bio as invisible unicode tag chars ─
    // payload text: nyx;c=RRGGBB,RRGGBB;b=<ref>;bp=x,y,z;d=<ref>;dp=dx,dy,s;a=<ref>;ap=x,y,z
    //   ref = i:<imgur file> | c:<catbox file> | https url.   bp/ap = x%,y%,zoom%.   dp = dx%,dy% of avatar size, scale%
    const profiles = new Map(Object.entries(cfg.known || {})); // userId -> { c:[a,b]|null, b, d, a, bp, ap, dp }
    let lastProf = null;
    const PROFILE_URL = /\/users\/\d+\/profile(\?|$)/;
    const PROF = '.user-profile-popout, .user-profile-modal, [class*="userPopoutOuter"], [class*="userProfileOuter"], [class*="userPopout_"], [class*="userProfileModal"]';
    const tagEnc = t => [...t.replace(/[^\x20-\x7e]/g, '')].map(c => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('');
    const tagDec = t => { let o = ''; for (const ch of t) { const c = ch.codePointAt(0); if (c >= 0xE0020 && c <= 0xE007E) o += String.fromCharCode(c - 0xE0000); } return o; };
    const uidOf = u => (/\/users\/(\d+)\/|\/(?:avatars|banners)\/(\d+)\//.exec(u || '') || []).slice(1).find(Boolean);
    const avUid = img => img.dataset.nyxUid || uidOf(img.src);
    const bak = x => { if (!('nyxBak' in x.dataset)) x.dataset.nyxBak = x.getAttribute('style') || ''; };
    const T = (p, k, d) => (Array.isArray(p[k]) && p[k].length === 3) ? p[k] : d;
    const tri = (s, d) => { const m = /^(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : d.slice(); };
    const same = (t, d) => !t || t.every((v, i) => Math.round(v) === d[i]);

    function parsePayload(bio) {
        let t = tagDec(bio || '');
        if (!t.startsWith('nyx;')) { const v = /nyx;[\w=,;:.\-\/%~]*/.exec(bio || ''); t = v ? v[0] : ''; } // visible plain-text fallback
        if (!t.startsWith('nyx;')) return null;
        const o = {};
        t.split(';').slice(1).forEach(kv => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1); });
        const c = /^([0-9a-f]{6}),([0-9a-f]{6})$/i.exec(o.c || '');
        return { c: c ? ['#' + c[1], '#' + c[2]] : null, b: o.b || '', d: o.d || '', a: o.a || '', bp: tri(o.bp, BP), ap: tri(o.ap, AP), dp: tri(o.dp, DP) };
    }

    function readProfile(j) {
        const id = j && j.user && j.user.id;
        if (!id) return;
        lastProf = id;
        // check every bio slot (global profile, per-server profile, legacy) and take the first one carrying a payload
        const bios = [j.user_profile && j.user_profile.bio, j.guild_member_profile && j.guild_member_profile.bio, j.user && j.user.bio];
        let p = null;
        for (const b of bios) { p = parsePayload(b); if (p) break; }
        log('profile fetched', id, p ? 'payload found' : 'no payload', p);
        if (p) { profiles.set(id, p); cfg.known[id] = p; }
        else { profiles.delete(id); delete cfg.known[id]; }
        const ks = Object.keys(cfg.known);
        if (ks.length > 300) ks.slice(0, ks.length - 300).forEach(k => delete cfg.known[k]);
        save();
        if (enabled) schedule();
    }

    function sniff(resource, p) {
        try {
            const u = typeof resource === 'string' ? resource : (resource && resource.url) || '';
            if (PROFILE_URL.test(u)) p.then(r => r.clone().json()).then(readProfile).catch(() => {});
        } catch (e) {}
        return p;
    }

    const HOSTS = { i: 'https://i.imgur.com/', c: 'https://files.catbox.moe/', t: 'https://media.tenor.com/', t1: 'https://media1.tenor.com/', tc: 'https://c.tenor.com/' };
    function shorten(u, b64) { // url -> short ref (keeps the bio payload / marker small)
        u = u.trim();
        if (/^(i\.imgur\.com|files\.catbox\.moe)\//.test(u)) u = 'https://' + u;
        u = u.replace(/^http:/, 'https:');
        for (const k in HOSTS) if (u.startsWith(HOSTS[k])) return k + ':' + u.slice(HOSTS[k].length).split('?')[0];
        // base64 alphabet avoids "_" (discord markdown eats paired underscores and corrupted the marker): + -> -, / -> .
        return b64 ? 'b:' + btoa(encodeURI(u)).replace(/\+/g, '-').replace(/\//g, '.').replace(/=+$/, '') : u;
    }
    const normRef = r => shorten((r || '').trim(), false);
    const refUrl = r => {
        const m = /^(\w+):(.*)$/.exec(r || '');
        if (m && HOSTS[m[1]]) return HOSTS[m[1]] + m[2];
        if (m && m[1] === 'b') { try { const u = decodeURI(atob(m[2].replace(/-/g, '+').replace(/[._]/g, '/'))); return /^https:\/\//.test(u) ? u : null; } catch (e) { return null; } }
        return /^https:\/\//.test(r || '') ? r : null;
    };
    // tenor.com/view/... is a web page, not an image: pull the real gif url out of it
    async function tenorDirect(u) {
        const html = new TextDecoder().decode(await gmGet(u));
        const m = /property="og:image"[^>]*content="([^"]+)"/.exec(html) || /(https:\/\/media\d?\.tenor\.com\/[^"'\s<>\\]+?\.gif)/.exec(html);
        if (!m) throw new Error('no gif found on page');
        return m[1].replace(/&amp;/g, '&');
    }
    const isTenorPage = v => /tenor\.com\/view\//.test(v || '');
    async function resolveTenorProf() {
        for (const k of ['b', 'd', 'a']) {
            if (!isTenorPage(cfg.prof[k])) continue;
            try { cfg.prof[k] = await tenorDirect(cfg.prof[k].trim()); save(); } catch (e) { console.warn('[opsec] tenor resolve failed', e); }
        }
    }

    const bufCache = new Map(), blobCache = new Map();
    function refBuf(r) {
        const u = refUrl(r || '');
        if (!u) return Promise.reject(new Error('bad ref'));
        if (!bufCache.has(r)) bufCache.set(r, gmGet(u).catch(e => { bufCache.delete(r); throw e; }));
        return bufCache.get(r);
    }
    function refBlob(r) {
        if (!blobCache.has(r)) {
            blobCache.set(r, refBuf(r).then(b => {
                const ext = ((/\.(\w{3,4})(?:\?|$)/.exec(refUrl(r)) || [])[1] || 'png').toLowerCase();
                return URL.createObjectURL(new Blob([b], { type: sniffImg(b) || MIME[ext] || 'image/png' }));
            }).catch(e => { blobCache.delete(r); throw e; }));
        }
        return blobCache.get(r);
    }

    // ─── Cover rendering (banner + editor frames): image sized in px from the real box, so drag math is 1:1 ─
    const coverGeom = (nw, nh, fw, fh, z) => { const s = Math.max(fw / nw, fh / nh) * z / 100; return { w: nw * s, h: nh * s }; };
    const covers = new WeakMap(); // .nyx-cv element -> { im, t, ref }
    const findCv = host => [...host.children].find(c => c.classList && c.classList.contains('nyx-cv'));
    const coverRO = typeof ResizeObserver === 'function'
        ? new ResizeObserver(es => es.forEach(e => { const cv = findCv(e.target); if (cv) layoutCover(cv); })) : null;

    function layoutCover(cv) {
        const s = covers.get(cv), host = cv.parentElement;
        if (!s || !host) return;
        const fw = host.clientWidth, fh = host.clientHeight, nw = s.im.naturalWidth, nh = s.im.naturalHeight;
        if (!fw || !fh || !nw || !nh) return;
        const { w, h } = coverGeom(nw, nh, fw, fh, s.t[2]);
        Object.assign(s.im.style, { width: w + 'px', height: h + 'px', left: (fw - w) * s.t[0] / 100 + 'px', top: (fh - h) * s.t[1] / 100 + 'px' });
    }

    function mountCover(host, ref, t) {
        let cv = findCv(host);
        if (!cv) {
            const im = el('img', { draggable: false });
            Object.assign(im.style, { position: 'absolute', maxWidth: 'none', maxHeight: 'none', pointerEvents: 'none', userSelect: 'none' });
            cv = el('div', { className: 'nyx-cv' }, im);
            // z-index -1 inside an isolated host = above the host background, below everything else in it
            Object.assign(cv.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '-1' });
            covers.set(cv, { im, t, ref: '' });
            im.addEventListener('load', () => layoutCover(cv));
            host.style.isolation = 'isolate';
            host.prepend(cv);
            if (coverRO) coverRO.observe(host);
        }
        const s = covers.get(cv);
        s.t = t;
        if (s.ref !== ref) {
            s.ref = ref;
            refBlob(ref).then(u => { if (s.ref === ref) s.im.src = u; }).catch(e => console.warn('[opsec] cover failed', ref, e));
        } else layoutCover(cv);
        return cv;
    }

    // ─── Avatar replacement (gif/png) with pan + zoom baked into an svg when not default ─
    const bakeCache = new Map();
    function avatarSrc(ref, t) {
        if (same(t, AP)) return refBlob(ref);
        const k = ref + '|' + t.map(Math.round).join(',');
        if (!bakeCache.has(k)) bakeCache.set(k, (async () => {
            const buf = await refBuf(ref), mime = sniffImg(buf) || 'image/png';
            const bu = URL.createObjectURL(new Blob([buf], { type: mime }));
            const [nw, nh] = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => rej(new Error('bad image')); i.src = bu; });
            URL.revokeObjectURL(bu);
            const S = 256, { w, h } = coverGeom(nw, nh, S, S, t[2]);
            const u8 = new Uint8Array(buf); let bin = '';
            for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><image href="data:${mime};base64,${btoa(bin)}" x="${(S - w) * t[0] / 100}" y="${(S - h) * t[1] / 100}" width="${w}" height="${h}" preserveAspectRatio="none"/></svg>`;
            return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        })().catch(e => { bakeCache.delete(k); throw e; }));
        return bakeCache.get(k);
    }

    function avaReplace(img) {
        const uid = avUid(img), p = uid && profiles.get(uid);
        if (!p || !p.a) return;
        const t = T(p, 'ap', AP), want = p.a + '|' + t.map(Math.round).join(',');
        if (img.dataset.nyxAv === want && img.src.startsWith('blob:')) return;
        avatarSrc(p.a, t).then(u => {
            if (!enabled || !img.isConnected) return;
            if (!img.src.startsWith('blob:')) img.dataset.nyxOa = img.src;
            img.dataset.nyxUid = uid; img.dataset.nyxAv = want;
            img.removeAttribute('srcset'); img.src = u;
        }).catch(e => console.warn('[opsec] avatar failed', e));
    }
    function avaRestore(img) {
        if (img.dataset.nyxOa) img.src = img.dataset.nyxOa;
        delete img.dataset.nyxOa; delete img.dataset.nyxUid; delete img.dataset.nyxAv;
    }

    // ─── Decorations: a fixed overlay layer that tracks each avatar every frame ─
    // (the old version glued the decoration inside the avatar's parent, which got clipped by overflow:hidden,
    //  measured during the modal's open animation, and never moved again = broken in the full profile)
    const layer = el('div', { id: 'nyx-layer' });
    const decos = new Map(); // avatar img -> { d: overlay img, p: profile, vis }
    let raf = 0, frameN = 0;
    const mountLayer = () => { if (document.body && !layer.isConnected) document.body.append(layer); };

    function untrack(img) { const r = decos.get(img); if (r) { r.d.remove(); decos.delete(img); } }
    function trackImg(img) {
        if (!enabled) return;
        const uid = avUid(img), p = uid && profiles.get(uid);
        if (!p || !p.d) { untrack(img); return; }
        mountLayer();
        let r = decos.get(img);
        if (r && r.ref !== p.d) { untrack(img); r = null; }
        if (!r) {
            const d = el('img', { className: 'nyx-deco', draggable: false });
            r = { d, p, ref: p.d, vis: undefined };
            decos.set(img, r); layer.append(d);
            refBlob(p.d).then(u => { d.src = u; }).catch(e => console.warn('[opsec] decoration failed', e));
        }
        r.p = p;
        kick();
    }
    // is the avatar actually on top at its position (not scrolled under a header, not behind a modal/menu)?
    function seen(img, r) {
        if (r.width < 6 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
        const g = ((img.closest('svg') || img).parentElement || {}).parentElement;
        for (const f of [[.5, .5], [.3, .3], [.7, .7]]) {
            const top = document.elementFromPoint(r.left + r.width * f[0], r.top + r.height * f[1]);
            if (top && (top === img || img.contains(top) || top.contains(img) || (g && g.contains(top)))) return true;
        }
        return false;
    }
    function tick() {
        raf = 0;
        if (!enabled || !decos.size) return;
        frameN++;
        const rows = [];
        for (const [img, row] of decos) {
            if (!img.isConnected) { row.d.remove(); decos.delete(img); continue; }
            const r = img.getBoundingClientRect();
            if (row.vis === undefined || frameN % 5 === 0) row.vis = seen(img, r);
            rows.push([row, r]);
        }
        for (const [row, r] of rows) {
            const d = row.d, t = T(row.p, 'dp', DP);
            if (!row.vis || !d.getAttribute('src')) { d.style.display = 'none'; continue; }
            const w = r.width * t[2] / 100;
            d.style.display = 'block';
            d.style.width = d.style.height = w + 'px';
            d.style.transform = `translate(${r.left + r.width / 2 + t[0] / 100 * r.width - w / 2}px,${r.top + r.height / 2 + t[1] / 100 * r.width - w / 2}px)`;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() { if (!raf && enabled && decos.size) raf = requestAnimationFrame(tick); }

    // ─── Applying profiles to popouts + the full profile modal ───────────────
    let schedT = 0;
    function schedule() { // throttled: at most one pass per 250ms no matter how many dom mutations fire
        if (schedT || !enabled) return;
        schedT = setTimeout(() => { schedT = 0; try { applyProfiles(); } catch (e) { console.warn('[opsec] apply error', e); } }, 250);
    }

    const big = x => { const r = x.getBoundingClientRect(); return r.width > innerWidth * .9 && r.height > innerHeight * .9; };

    function profileRoots() {
        const s = new Set(document.querySelectorAll(PROF));
        document.querySelectorAll('[role="dialog"]').forEach(d => { // full profile modal: found by shape, not by class name
            if (d.querySelector(AV_SEL) && d.querySelector('[class*="banner" i]')) s.add(d);
        });
        const all = [...s].filter(x => !big(x));
        return all.filter(x => !all.some(y => y !== x && y.contains(x)));
    }

    // computed background-color -> alpha (handles rgb/rgba and color(... / a) forms)
    const alphaOf = bc => {
        if (!bc || bc === 'transparent') return 0;
        let m = /^rgba?\(([^)]+)\)$/.exec(bc);
        if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean); if (p.length < 4) return 1; const v = parseFloat(p[3]); return /%/.test(p[3]) ? v / 100 : v; }
        m = /\/\s*([\d.]+)(%?)\s*\)$/.exec(bc);
        return m ? +m[1] / (m[2] ? 100 : 1) : 1;
    };
    const BADCLS = /button|icon|badge|pill|overlay|menu/i;
    const geoOK = (r, cr) => r.width >= cr.width * .85 && r.height >= 36 && r.height <= 340 && r.top >= cr.top - 4 && r.top <= cr.top + 30;

    // the card = outermost element around the avatar that still looks like a card (not the full-screen layer)
    function pickCard(c, av) {
        let card = null;
        for (let e = av; e; e = e.parentElement) {
            const r = e.getBoundingClientRect();
            if (r.width >= 200 && r.width <= innerWidth * .95 && !big(e)) card = e;
            if (e === c) break;
        }
        return card || c;
    }

    // banner = the short, full-width element at the very top of the card. class name first, geometry as fallback
    function findBanner(card) {
        const cr = card.getBoundingClientRect(), all = [...card.querySelectorAll('*')].slice(0, 700);
        let byClass = null, byGeo = null;
        for (const x of all) {
            if (x instanceof SVGElement || x.closest('.nyx-cv')) continue;
            const cl = x.getAttribute('class') || '';
            if (BADCLS.test(cl)) continue;
            const r = x.getBoundingClientRect();
            if (!geoOK(r, cr)) continue;
            if (/banner/i.test(cl)) { if (!byClass || r.height <= byClass.h + .5) byClass = { x, h: r.height }; }
            else if (!byGeo || r.height <= byGeo.h + .5) byGeo = { x, h: r.height };
        }
        if (byClass) return byClass.x;
        let best = null, area = 0; // the old heuristic: biggest innermost "banner" element
        all.forEach(x => {
            const cl = x.getAttribute('class') || '';
            if (x instanceof SVGElement || x.closest('.nyx-cv') || !/banner/i.test(cl) || BADCLS.test(cl) || x.querySelector('[class*="banner" i]')) return;
            const r = x.getBoundingClientRect(), a = r.width * r.height;
            if (r.width >= 100 && r.height >= 30 && a >= area) { best = x; area = a; }
        });
        return best || (byGeo && byGeo.x);
    }

    // discord draws its own banner picture on the element or on children/svg inside it; hide those so ours is the one you see
    function clearBannerArt(bn) {
        bak(bn); bn.style.setProperty('background-image', 'none', 'important');
        bn.querySelectorAll('*').forEach(x => {
            if (x.closest('.nyx-cv')) return;
            const t = x.tagName.toLowerCase();
            if (t === 'img' || t === 'image' || t === 'video') {
                if (x.matches && x.matches(AV_SEL)) return;
                if (x.getBoundingClientRect().width >= bn.clientWidth * .5) { bak(x); x.style.setProperty('visibility', 'hidden', 'important'); }
                return;
            }
            if (x instanceof SVGElement) return;
            const cs = getComputedStyle(x), r = x.getBoundingClientRect();
            if (/url\(/.test(cs.backgroundImage)) { bak(x); x.style.setProperty('background-image', 'none', 'important'); }
            if (r.width >= bn.clientWidth * .9 && r.height >= bn.clientHeight * .9 && alphaOf(cs.backgroundColor) > .05) { bak(x); x.style.setProperty('background-color', 'transparent', 'important'); }
        });
    }

    // gradient goes on the OUTERMOST opaque panel in the card; opaque panels directly inside it turn translucent so it shows through.
    // (old version painted whatever the "root" was, which was sometimes a wrapper hidden behind the real card)
    function paintCard(card, p, bn) {
        const vars = [card, ...card.querySelectorAll('[style*="--profile-gradient"]')];
        const up = card.closest('[style*="--profile-gradient"]'); if (up) vars.push(up);
        vars.forEach(x => {
            bak(x);
            x.style.setProperty('--profile-gradient-primary-color', p.c[0]);
            x.style.setProperty('--profile-gradient-secondary-color', p.c[1]);
            x.style.setProperty('--profile-gradient-overlay-color', 'rgba(0,0,0,.35)');
        });
        const cr = card.getBoundingClientRect(), panels = [];
        let n = 0;
        for (const x of [card, ...card.querySelectorAll('*')]) {
            if (++n > 800) break;
            if (x instanceof SVGElement || x.closest('.nyx-cv') || (bn && (x === bn || bn.contains(x)))) continue;
            if (/^(IMG|VIDEO|CANVAS|BUTTON|INPUT|TEXTAREA)$/.test(x.tagName)) continue;
            if (x !== card) {
                const r = x.getBoundingClientRect();
                if (r.width < cr.width * .4 || r.height < 36 || r.left < cr.left - 3 || r.right > cr.right + 3 || r.top < cr.top - 3 || r.bottom > cr.bottom + 3) continue;
            }
            const cs = getComputedStyle(x);
            if (/url\(/.test(cs.backgroundImage)) continue;
            if (alphaOf(cs.backgroundColor) < .5 && !/gradient/.test(cs.backgroundImage)) continue;
            panels.push(x);
        }
        const g = [card, ...card.querySelectorAll('[data-nyx-th="g"]')].find(x => x.dataset.nyxTh === 'g') || panels[0] || card;
        bak(g); g.dataset.nyxTh = 'g';
        g.style.setProperty('background', `linear-gradient(${p.c[0]},${p.c[1]})`, 'important');
        const done = [...card.querySelectorAll('[data-nyx-th="t"]')];
        for (const x of panels) {
            if (x === g || x.contains(g) || x.dataset.nyxTh === 'g') continue;
            if (done.some(t => t.contains(x))) continue; // already under a translucent one, don't stack darkness
            bak(x); x.dataset.nyxTh = 't'; done.push(x);
            x.style.setProperty('background', 'rgba(0,0,0,.35)', 'important');
        }
        log('painted gradient on', g.className, 'translucent panels:', done.length);
    }

    function themeRoot(c) {
        let uid = null, av = null, area = 0;
        c.querySelectorAll(AV_SEL).forEach(i => { // the biggest known avatar in here is the profile owner
            const u = avUid(i); if (!u || !profiles.has(u)) return;
            const r = i.getBoundingClientRect(), a = r.width * r.height;
            if (a > area) { uid = u; av = i; area = a; }
        });
        let p = uid && profiles.get(uid);
        if (!p) { // fallback: read the payload straight from the bio text shown in the profile
            p = parsePayload(c.textContent);
            if (p && lastProf) profiles.set(lastProf, p);
        }
        if (!p) return;
        const card = av ? pickCard(c, av) : c;
        const bn = findBanner(card); // always found, so the native banner is never mistaken for a panel
        log('theming', 'root:', c.className, '| card:', card.className, '| banner:', bn && bn.className);
        if (p.c) paintCard(card, p, bn);
        if (p.b && bn) {
            bak(bn);
            if (getComputedStyle(bn).position === 'static') bn.style.position = 'relative';
            bn.style.overflow = 'hidden';
            clearBannerArt(bn);
            mountCover(bn, p.b, T(p, 'bp', BP));
        }
    }

    function applyProfiles() {
        if (!enabled) return;
        document.querySelectorAll(AV_SEL).forEach(i => { avaReplace(i); trackImg(i); });
        document.querySelectorAll('img[data-nyx-oa]').forEach(i => { const u = avUid(i), p = u && profiles.get(u); if (!p || !p.a) avaRestore(i); });
        profileRoots().forEach(themeRoot);
    }

    function genPayload(vis) {
        const p = cfg.prof, ref = r => normRef(r), n3 = t => t.map(v => Math.round(v)).join(',');
        const parts = ['nyx'];
        if (p.c) parts.push('c=' + p.c1.slice(1) + ',' + p.c2.slice(1));
        if (p.b.trim()) { parts.push('b=' + ref(p.b)); if (!same(p.bp, BP)) parts.push('bp=' + n3(p.bp)); }
        if (p.d.trim()) { parts.push('d=' + ref(p.d)); if (!same(p.dp, DP)) parts.push('dp=' + n3(p.dp)); }
        if ((p.a || '').trim()) { parts.push('a=' + ref(p.a)); if (!same(p.ap, AP)) parts.push('ap=' + n3(p.ap)); }
        const s = parts.join(';') + ';';
        return vis ? s : tagEnc(s);
    }

    // ─── Position editor: drag to move, scroll to zoom ───────────────────────
    let editor = null;
    async function openEditor() {
        if (editor) { editor.remove(); editor = null; return; }
        await resolveTenorProf();
        const P = cfg.prof;
        const ed = el('div', { id: 'nyx-editor' });
        ed.addEventListener('keydown', e => e.stopPropagation());

        const drag = (frame, onMove, onWheel) => {
            frame.addEventListener('pointerdown', e => {
                e.preventDefault();
                try { frame.setPointerCapture(e.pointerId); } catch (x) {}
                let lx = e.clientX, ly = e.clientY;
                const mv = ev => { onMove(ev.clientX - lx, ev.clientY - ly); lx = ev.clientX; ly = ev.clientY; };
                const up = () => { frame.removeEventListener('pointermove', mv); frame.removeEventListener('pointerup', up); frame.removeEventListener('pointercancel', up); };
                frame.addEventListener('pointermove', mv); frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up);
            });
            frame.addEventListener('wheel', e => { e.preventDefault(); onWheel(e.deltaY < 0 ? 1 : -1); }, { passive: false });
        };
        const sec = (title, hint) => el('div', {}, el('h4', { textContent: title }), el('div', { className: 'nyx-hint', textContent: hint }));
        const zoomRow = (t, min, max, onChange) => {
            const r = el('input', { type: 'range', min, max, value: t[2] });
            r.oninput = () => { t[2] = +r.value; save(); onChange(); };
            return { row: el('label', {}, 'zoom', r), sync: () => { r.value = t[2]; } };
        };

        // banner + avatar: the image inside a fixed frame
        const coverSection = (title, key, rawRef, w, h, round) => {
            const t = P[key], def = key === 'bp' ? BP : AP, ref = (rawRef || '').trim() ? normRef(rawRef) : '';
            const s = sec(title, ref ? 'drag to move · scroll to zoom' : 'set the url in the main panel first');
            if (!ref) return s;
            const f = el('div', { className: 'nyx-frame' });
            Object.assign(f.style, { width: w + 'px', height: h + 'px', borderRadius: round ? '50%' : '0' });
            s.append(f);
            ed.append(s); // frame must be in the dom before it can be measured
            mountCover(f, ref, t);
            const z = zoomRow(t, 100, 400, () => layoutCover(findCv(f)));
            const lay = () => { const cv = findCv(f); if (cv) layoutCover(cv); z.sync(); save(); };
            drag(f, (dx, dy) => {
                const cv = findCv(f), im = covers.get(cv).im;
                if (!im.naturalWidth) return;
                const fw = f.clientWidth, fh = f.clientHeight, g = coverGeom(im.naturalWidth, im.naturalHeight, fw, fh, t[2]);
                if (Math.abs(fw - g.w) > 1) t[0] = clamp(t[0] + dx / (fw - g.w) * 100, 0, 100);
                if (Math.abs(fh - g.h) > 1) t[1] = clamp(t[1] + dy / (fh - g.h) * 100, 0, 100);
                lay();
            }, dir => { t[2] = clamp(t[2] + dir * 5, 100, 400); lay(); });
            s.append(z.row, el('button', { textContent: 'reset', onclick: () => { t.splice(0, 3, ...def); lay(); } }));
            return s;
        };

        // decoration: offset + scale relative to the avatar
        const decoSection = () => {
            const t = P.dp, ref = (P.d || '').trim() ? normRef(P.d) : '';
            const s = sec('decoration', ref ? 'drag to move · scroll to resize' : 'set the url in the main panel first');
            if (!ref) return s;
            const A = 96, FR = 176, C = FR / 2;
            const f = el('div', { className: 'nyx-frame' });
            Object.assign(f.style, { width: FR + 'px', height: FR + 'px' });
            const av = el('div'); Object.assign(av.style, { position: 'absolute', left: C - A / 2 + 'px', top: C - A / 2 + 'px', width: A + 'px', height: A + 'px', borderRadius: '50%', background: '#5865f2' });
            if ((P.a || '').trim()) refBlob(normRef(P.a)).then(u => { av.style.background = `url(${u}) center/cover`; }).catch(() => {});
            const di = el('img', { draggable: false }); Object.assign(di.style, { position: 'absolute', pointerEvents: 'none' });
            refBlob(ref).then(u => { di.src = u; }).catch(() => { s.append(el('div', { className: 'nyx-hint', textContent: 'could not load decoration url' })); });
            f.append(av, di); s.append(f);
            const z = zoomRow(t, 40, 300, () => {});
            const lay = () => {
                const w = A * t[2] / 100;
                Object.assign(di.style, { width: w + 'px', height: w + 'px', left: C + t[0] / 100 * A - w / 2 + 'px', top: C + t[1] / 100 * A - w / 2 + 'px' });
                z.sync(); save();
            };
            z.row.querySelector('input').oninput = e => { t[2] = +e.target.value; lay(); };
            drag(f, (dx, dy) => { t[0] = clamp(t[0] + dx / A * 100, -150, 150); t[1] = clamp(t[1] + dy / A * 100, -150, 150); lay(); },
                dir => { t[2] = clamp(t[2] + dir * 5, 40, 300); lay(); });
            lay();
            s.append(z.row, el('button', { textContent: 'reset', onclick: () => { t.splice(0, 3, ...DP); lay(); } }));
            return s;
        };

        ed.append(el('div', { textContent: 'position editor — saved automatically' }));
        const b = coverSection('banner', 'bp', P.b, 300, 105, false); if (!b.isConnected) ed.append(b);
        const a = coverSection('avatar (gif/png)', 'ap', P.a, 96, 96, true); if (!a.isConnected) ed.append(a);
        ed.append(decoSection());
        ed.append(el('div', { className: 'nyx-hint', style: 'margin-top:10px', textContent: 'then hit "generate + copy" in the main panel and paste into your about me.' }));
        ed.append(el('button', { className: 'nyx-done', textContent: 'done', onclick: () => { ed.remove(); editor = null; } }));
        document.body.append(ed);
        editor = ed;
    }

    // ─── Gui ──────────────────────────────────────────────────────────────────
    // alt+d with a profile open: copies a compact tree of the card (tag, class, size, background) to the clipboard
    function domDump() {
        const out = [], roots = profileRoots();
        if (!roots.length) return 'no profile open';
        const bg = x => { const cs = getComputedStyle(x), im = cs.backgroundImage; return `bg:${alphaOf(cs.backgroundColor).toFixed(2)}${im !== 'none' ? (/url\(/.test(im) ? ' url' : /gradient/.test(im) ? ' grad' : ' img') : ''}`; };
        const walk = (x, d) => {
            if (d > 9) return;
            const r = x.getBoundingClientRect();
            if (r.width < 24 || r.height < 24) return;
            const role = x.getAttribute('role');
            out.push(`${'  '.repeat(d)}${x.tagName.toLowerCase()}${role ? '[' + role + ']' : ''}.${(x.getAttribute('class') || '').trim().split(/\s+/).join('.')} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} ${bg(x)}${x.dataset && x.dataset.nyxTh ? ' th=' + x.dataset.nyxTh : ''}`);
            [...x.children].slice(0, 30).forEach(ch => walk(ch, d + 1));
        };
        roots.forEach((r, i) => { out.push('== root ' + i + ' =='); walk(r, 0); });
        return out.join('\n');
    }

    let gui = null;
    function buildGui() {
        const g = el('div', { id: 'nyx-gui', style: 'display:block' });
        g.addEventListener('keydown', e => e.stopPropagation());
        const chk = (t, id, get, set) => {
            const i = el('input', { type: 'checkbox', checked: get() });
            if (id) i.id = id;
            i.onchange = () => { set(i.checked); save(); apply(); };
            return el('label', {}, t, i);
        };
        g.append(el('div', { textContent: 'opsec 1 million script' }),
            el('button', { id: 'nyx-en', textContent: enabled ? 'on' : 'off', onclick: () => setEnabled(!enabled) }),
            chk('hide normal msgs + files', '', () => cfg.hide, v => { cfg.hide = v; if (enabled) scanAll(); }),
            chk('start enabled on load', '', () => cfg.auto, v => { cfg.auto = v; }),
            chk('debug logging', '', () => cfg.debug, v => { cfg.debug = v; }));
        for (const [k, t] of [['enc', 'encrypted text'], ['plain', 'normal text'], ['file', 'files (border)']]) {
            g.append(el('h4', { textContent: t }));
            for (const [f, n, ty] of [['fg', 'color', 'color'], ['bg', 'background', 'color'], ['ba', 'bg opacity', 'range'], ['op', 'opacity', 'range']]) {
                const i = el('input', { type: ty, value: cfg[k][f] });
                i.oninput = () => { cfg[k][f] = ty === 'range' ? +i.value : i.value; save(); apply(); };
                g.append(el('label', {}, n, i));
            }
        }
        g.append(el('h4', { textContent: 'library (use :name: in msgs)' }));
        const ln = el('input', { type: 'text', placeholder: 'name' }), lu = el('input', { type: 'text', placeholder: 'emoji/sticker url or id' });
        g.append(el('label', {}, ln), el('label', {}, lu), el('button', { textContent: 'add', onclick: async () => {
            let v = lu.value.trim();
            if (isTenorPage(v)) {
                try { v = await tenorDirect(v); } catch (e) { alert('could not read that tenor page. right click the gif > copy image address, and paste that (media.tenor.com/...gif)'); return; }
            }
            const a = parseAsset(v, ln.value.trim());
            if (a) { addLib(a, ln.value.trim() || a.n); ln.value = lu.value = ''; }
        } }));
        libBox = el('div'); g.append(libBox); renderLib();
        g.append(el('div', { textContent: 'alt+click any emoji or sticker in chat to save it', style: 'color:#888;margin-top:4px' }));

        g.append(el('h4', { textContent: 'profile (paste into your bio)' }));
        const pfield = (n, ty, k) => {
            const i = el('input', { type: ty });
            if (ty === 'checkbox') i.checked = cfg.prof[k]; else i.value = cfg.prof[k];
            i.oninput = i.onchange = () => { cfg.prof[k] = ty === 'checkbox' ? i.checked : i.value; save(); };
            g.append(el('label', {}, n, i));
        };
        pfield('use colors', 'checkbox', 'c'); pfield('color 1', 'color', 'c1'); pfield('color 2', 'color', 'c2');
        pfield('banner url', 'text', 'b'); pfield('decoration url', 'text', 'd'); pfield('avatar url (gif/png)', 'text', 'a');
        g.append(el('button', { textContent: 'position editor (drag to place)', onclick: openEditor }));
        const info = el('div', { style: 'color:#888;margin-top:4px;word-break:break-all' });
        const sizeNote = t => { const cp = [...t].length; return `${cp}/190 chars` + (t.length !== cp ? ` (${t.length} utf-16)` : ''); };
        g.append(el('button', { textContent: 'generate + copy', onclick: async () => {
            await resolveTenorProf();
            const t = genPayload();
            navigator.clipboard.writeText(t).then(
                () => { info.textContent = `copied (${sizeNote(t)}). paste it at the end of your about me`; },
                () => { info.textContent = 'copy failed, click the page and try again'; });
        } }), info);

        g.append(el('button', { textContent: 'copy visible version (test)', onclick: async () => {
            await resolveTenorProf();
            const t = genPayload(true);
            navigator.clipboard.writeText(t).then(() => { info.textContent = 'copied visible text: ' + t; }, () => { info.textContent = 'copy failed'; });
        } }));
        g.append(el('div', { textContent: 'debug: alt+d with a profile open copies its dom layout', style: 'color:#888;margin-top:6px' }));
        g.append(el('button', { textContent: 'reset', onclick: () => {
            cfg = { ...JSON.parse(JSON.stringify(D)), lib: cfg.lib, prof: cfg.prof, known: cfg.known }; save(); apply();
            gui.remove(); gui = null; toggleGui();
        } }));
        return g;
    }
    function toggleGui() {
        if (!gui) { gui = buildGui(); document.body.append(gui); return; }
        gui.style.display = gui.style.display === 'none' ? 'block' : 'none';
    }

    function mount() {
        if (!document.body) return;
        if (gui && !gui.isConnected) document.body.append(gui);
        if (decos.size) mountLayer();
    }
    document.addEventListener('DOMContentLoaded', () => { mount(); if (enabled) { scanAll(); schedule(); } });
    setInterval(() => { mount(); if (enabled) schedule(); }, 1500); // safety net: modal animations, lazy layout

    let rs = false; // right shift pressed alone = open gui
    window.addEventListener('keydown', e => {
        if (e.code === 'ShiftRight') { if (!e.repeat) rs = true; } else rs = false;
        // e.code, not e.key: on macOS option+n is a dead key and e.key never equals "n"
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') { e.preventDefault(); setEnabled(!enabled); }
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyD') {
            e.preventDefault();
            const t = domDump(); console.log('[opsec] dom dump\n' + t);
            try { navigator.clipboard.writeText(t); } catch (x) {}
        }
    }, true);
    window.addEventListener('keyup', e => {
        if (e.code === 'ShiftRight' && rs) { rs = false; toggleGui(); }
    }, true);

    console.log('[opsec 1 million script v15.2.2] loaded. enabled =', enabled);
})();
