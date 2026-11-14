// ==UserScript==
// @name         nyxscript
// @namespace    https://github.com/oci3/nyxscript
// @version      19.5.0
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
        auto: false,
        debug: false,
        vanilla: true, // encryption/decryption + emojis only, no custom visuals
        hide: true, // remove normal (non-encrypted) messages + files from view
        fnb: false, // no border/padding around decrypted files
        imgur: '', // optional imgur client id: text-based upload path if catbox mangles binary
        min: false, // with hide on: collapse normal messages to a one-line stub (click to show, click "hide" to collapse again) instead of removing them
        strip: true,
        notype: true,
        ptr: true,
        ver: 18,
        ufont: '', ufontc: '', // MY username font (shared with others through the bio payload)
        stag: false,
        names: {}, pfp: 'off', pnums: {}, pnext: 1, sp: { on: false, hov: true, att: true, emo: false, nm: true, pdn: true, pun: true, pbio: true },
        known: {}, own: [], // own: ids of my plain (!!) messages so they stay visible
        lib: [],
        prof: { c: false, c1: '#5865f2', c2: '#eb459e', tx: false, txc: '#ffffff', ux: false, uxc: '#ffffff', px: false, pxc: '#ffffff', hs: false, sb: false, sbc: '#1e1f22', sx: false, sxc: '#ffffff', ug: false, uxc2: '#eb459e', pg: false, pxc2: '#eb459e', ugl: false, pgl: false, ugs: 4, pgs: 4, cw: false, cwc: '#ffffff', cwn: 8, vw: false, vwc: '#ffffff', vwn: 8, ic: ['', '', ''], b: '', d: '', a: '', bp: BP.slice(), ap: AP.slice(), dp: DP.slice() },
        enc:   { fg: '#57f287', bg: '#000000', ba: 0,  op: 100 },
        plain: { fg: '#dbdee1', bg: '#000000', ba: 0,  op: 100 },
        file:  { fg: '#57f287', bg: '#000000', ba: 40, op: 100 }
    };
    let cfg = JSON.parse(JSON.stringify(D)), sv = 0;
    try {
        let raw = null;
        try { raw = GM_getValue(CFG_KEY, null); } catch (e) {}
        if (!raw) { try { raw = localStorage.getItem(CFG_KEY); } catch (e) {} }
        const s = JSON.parse(raw);
        sv = (s && s.ver) || 0;
        if (s) for (const k in s) cfg[k] = (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) ? { ...cfg[k], ...s[k] } : s[k];
    } catch (e) {}
    if (sv < 18) { cfg.hide = true; cfg.vanilla = true; }
    if (sv < 19) cfg.auto = false; // one-time: script starts OFF, turn it on with Alt+N or the gui
    cfg.ver = 19;
    if (!Array.isArray(cfg.own)) cfg.own = [];
    for (const [k, d] of [['bp', BP], ['ap', AP], ['dp', DP]]) {
        if (!Array.isArray(cfg.prof[k]) || cfg.prof[k].length !== 3) cfg.prof[k] = d.slice();
    }
    if (!Array.isArray(cfg.prof.ic)) cfg.prof.ic = ['', '', ''];
    const save = () => { try { GM_setValue(CFG_KEY, JSON.stringify(cfg)); } catch (e) { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e2) {} } };
    const log = (...a) => { if (cfg.debug) console.log('[opsec]', ...a); };

    let enabled = !!cfg.auto;
    const sent = new Set(), orig = new WeakMap(), plain = new Set(cfg.own);
    let tk = 0;

    const tag = x => Object.prototype.toString.call(x);
    const isFormData = x => tag(x) === '[object FormData]';
    const isBlob = x => tag(x) === '[object Blob]' || tag(x) === '[object File]';
    const el = (t, p = {}, ...c) => { const e = document.createElement(t); Object.assign(e, p); e.append(...c); return e; };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const nmOn = () => !cfg.vanilla && cfg.sp.on && cfg.sp.nm;
    const pfpOn = () => cfg.pfp !== 'off' && !cfg.vanilla;

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

    function expand(p) {
        return p.replace(/:(\w{2,32}):/g, (m, nm) => {
            const e = cfg.lib.find(x => x.n.toLowerCase() === nm.toLowerCase());
            return e ? (e.t === 'u' ? `{nyx|u|${e.id}}` : `{nyx|${e.t}|${e.id}|${e.x}}`) : m;
        });
    }

    // "!!" anywhere in a message = shortcut for a normal message: the marker is stripped and the text is sent plain (no cipher)
    const BYPASS = '!!';
    const bypassed = t => typeof t === 'string' && t.includes(BYPASS);
    const stripMark = t => t.split(BYPASS).join('').replace(/[ \t]{2,}/g, ' ').trim();
    // my own plain messages carry no marker anymore, so remember their ids (nonce first, real id once the server answers)
    let ownT = 0;
    const addPlain = id => { id = String(id); if (!/^\d+$/.test(id) || plain.has(id)) return; plain.add(id); cfg.own.push(id); if (cfg.own.length > 500) cfg.own.splice(0, cfg.own.length - 500); clearTimeout(ownT); ownT = setTimeout(save, 1500); };
    const dropPlain = id => { if (plain.delete(id)) { cfg.own = cfg.own.filter(x => x !== id); save(); } };
    function grabPlain(text) {
        try {
            const j = JSON.parse(text);
            if (j && j.id && plain.has(String(j.nonce))) {
                addPlain(j.id);
                const li = document.querySelector(`li[id$="-${j.id}"]`);
                if (li) processLi(li);
            }
        } catch (e) {}
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

    // ─── Metadata stripping: raw byte surgery, zero-padded back to the original length ─
    const cat = ps => { const o = new Uint8Array(ps.reduce((a, p) => a + p.length, 0)); let i = 0; for (const p of ps) { o.set(p, i); i += p.length; } return o; };
    function strip0(u) {
        const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), A = (o, n) => String.fromCharCode(...u.subarray(o, o + n));
        if (u[0] === 0xFF && u[1] === 0xD8) {
            const out = [u.subarray(0, 2)]; let i = 2, ori = 1;
            while (i + 4 <= u.length && u[i] === 0xFF) {
                const m = u[i + 1];
                if (m === 0xFF) { i++; continue; }
                if (m === 0xDA || m === 0xD9) break;
                const e = i + 2 + dv.getUint16(i + 2);
                if (m === 0xE1 && A(i + 4, 4) === 'Exif') {
                    try {
                        const t = i + 10, le = A(t, 2) === 'II', o = dv.getUint32(t + 4, le), n = dv.getUint16(t + o, le);
                        for (let k = 0; k < n; k++) if (dv.getUint16(t + o + 2 + k * 12, le) === 0x112) ori = dv.getUint16(t + o + 10 + k * 12, le);
                    } catch (x) {}
                }
                if (!(m === 0xE1 || m === 0xED || m === 0xFE || (m >= 0xE3 && m <= 0xEC))) out.push(u.subarray(i, e));
                i = e;
            }
            if (ori > 1 && ori < 9) out.splice(1, 0, Uint8Array.of(0xFF, 0xE1, 0, 0x22, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4D, 0x4D, 0, 0x2A, 0, 0, 0, 8, 0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, ori, 0, 0, 0, 0, 0, 0));
            out.push(u.subarray(i));
            return cat(out);
        }
        if (A(1, 3) === 'PNG') {
            const out = [u.subarray(0, 8)]; let i = 8;
            while (i + 12 <= u.length) {
                const n = dv.getUint32(i), t = A(i + 4, 4), e = i + 12 + n;
                if (!/^(tEXt|zTXt|iTXt|eXIf|tIME)$/.test(t)) out.push(u.subarray(i, e));
                i = e;
                if (t === 'IEND') break;
            }
            return cat(out);
        }
        if (A(0, 4) === 'RIFF' && A(8, 4) === 'WEBP') {
            const out = []; let i = 12;
            while (i + 8 <= u.length) {
                const t = A(i, 4), n = dv.getUint32(i + 4, true), e = i + 8 + n + (n & 1);
                if (t !== 'EXIF' && t !== 'XMP ') { const c = u.slice(i, e); if (t === 'VP8X') c[8] &= 0xF3; out.push(c); }
                i = e;
            }
            const b = cat(out), h = new Uint8Array(12 + b.length);
            h.set(u.subarray(0, 12)); h.set(b, 12);
            new DataView(h.buffer).setUint32(4, h.length - 8, true);
            return h;
        }
        if (A(4, 4) === 'ftyp' && /^(isom|iso\d|mp4\d|avc1|M4[VA] |qt  |3gp\d|dash)$/.test(A(8, 4))) {
            const c = u.slice(), cv = new DataView(c.buffer);
            const walk = (s, e) => {
                for (let i = s; i + 8 <= e;) {
                    let n = cv.getUint32(i), h = 8;
                    if (n === 1) { n = Number(cv.getBigUint64(i + 8)); h = 16; } else if (n === 0) n = e - i;
                    if (n < h || i + n > e) break;
                    const t = String.fromCharCode(...c.subarray(i + 4, i + 8));
                    if (t === 'udta' || t === 'meta') { c.fill(0, i + h, i + n); c.set([102, 114, 101, 101], i + 4); }
                    else if (t === 'moov' || t === 'trak') walk(i + h, i + n);
                    i += n;
                }
            };
            walk(0, c.length);
            return c;
        }
        if (A(0, 3) === 'ID3' || (u[0] === 0xFF && (u[1] & 0xE0) === 0xE0)) {
            let s = 0, e = u.length;
            if (A(0, 3) === 'ID3') s = 10 + (u[5] & 16 ? 10 : 0) + ((u[6] & 127) << 21 | (u[7] & 127) << 14 | (u[8] & 127) << 7 | (u[9] & 127));
            if (e - s > 128 && A(e - 128, 3) === 'TAG') e -= 128;
            return u.subarray(s, e);
        }
        return null;
    }
    function stripMeta(buf) {
        try {
            const u = new Uint8Array(buf), r = strip0(u);
            if (!r || r.length > u.length) return buf;
            const o = new Uint8Array(u.length); o.set(r);
            return o;
        } catch (e) { return buf; }
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

    function sniffExt(buf, ext) {
        const u = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
        const s = String.fromCharCode(...u);
        if (s.startsWith('ID3') || (u[0] === 0xFF && (u[1] & 0xE0) === 0xE0)) return 'mp3';
        if (s.startsWith('OggS')) return 'ogg';
        if (s.startsWith('fLaC')) return 'flac';
        if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'wav';
        return ext;
    }
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
                sent.add(String(json.nonce));
            }
            if (typeof json.content === 'string' && json.content.trim()) {
                const mid = method === 'POST' ? String(json.nonce) : (/\/messages\/(\d+)/.exec(url) || [])[1];
                if (bypassed(json.content)) {
                    json.content = stripMark(json.content); changed = true;
                    if (mid) addPlain(mid);
                } else {
                    if (mid && method !== 'POST') dropPlain(mid);
                    const enc = encode(json.content);
                    if (enc !== json.content) { json.content = enc; changed = true; }
                }
            }
            if (method === 'POST' && /^\d+$/.test(String(json.nonce))) {
                const pl = document.querySelector(`li[id$="-${json.nonce}"]`);
                if (pl) processLi(pl);
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
                const raw = await v.arrayBuffer(), enc = await encryptBytes(cfg.strip ? stripMeta(raw) : raw);
                out.append(k, new W.Blob([enc], { type: 'application/octet-stream' }), cloakName(v.name));
            } else out.append(k, v);
        }
        return out;
    }

    async function rewriteBody(body, url, method) {
        if (typeof body === 'string') return transformJson(body, url, method, false);
        if (isFormData(body)) return transformForm(body, url, method);
        if (method === 'PUT' && UPLOAD_URL.test(url) && isBlob(body)) {
            const raw = await body.arrayBuffer();
            return new W.Blob([await encryptBytes(cfg.strip ? stripMeta(raw) : raw)], { type: 'application/octet-stream' });
        }
        return body;
    }

    const TYPING = /\/channels\/\d+\/typing(\?|$)/;
    const noType = (url, m) => enabled && cfg.notype && m === 'POST' && TYPING.test(url);
    function fakeXhr(x, url) {
        const d = (k, v) => Object.defineProperty(x, k, { configurable: true, value: v });
        d('readyState', 4); d('status', 204); d('statusText', 'No Content'); d('response', ''); d('responseText', ''); d('responseURL', url);
        setTimeout(() => ['readystatechange', 'load', 'loadend'].forEach(t => x.dispatchEvent(new W.Event(t))), 0);
    }

    // if rewriting fails the request is dropped (never falls back to sending plaintext)
    const origFetch = W.fetch;
    W.fetch = function (resource, config) {
        try {
            const url = typeof resource === 'string' ? resource : (resource?.url || String(resource));
            const method = ((config && config.method) || (resource && resource.method) || 'GET').toUpperCase();
            if (noType(url, method)) return Promise.resolve(new W.Response(null, { status: 204 }));
            if (enabled && config && config.body != null && shouldRewrite(url, method)) {
                return rewriteBody(config.body, url, method)
                    .catch(err => { console.warn('[opsec] rewrite failed, not sent', err); throw err; })
                    .then(b => origFetch.call(W, resource, { ...config, body: b }))
                    .then(r => { if (method === 'POST' && MSG_URL.test(url)) { try { r.clone().text().then(grabPlain, () => {}); } catch (e) {} } return r; });
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
            if (m && noType(m.url, m.method)) return fakeXhr(this, m.url);
            if (m && m.method === 'GET' && PROFILE_URL.test(m.url)) {
                this.addEventListener('load', () => { try { readProfile(JSON.parse(this.responseText)); } catch (e) {} });
            }
            if (enabled && m && body != null && shouldRewrite(m.url, m.method)) {
                if (m.method === 'POST' && MSG_URL.test(m.url)) this.addEventListener('load', () => grabPlain(this.responseText));
                rewriteBody(body, m.url, m.method).then(b => origSend.call(this, b), err => { console.warn('[opsec] rewrite failed, not sent', err); try { this.abort(); } catch (e) {} });
                return;
            }
        } catch (e) { console.warn('[opsec] xhr hook error', e); }
        return origSend.call(this, body);
    };

    // ─── Styles ───────────────────────────────────────────────────────────────
    const rgba = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a / 100})`; };
    const BASE = `#nyx-gui{position:fixed;top:16px;right:72px;z-index:100000;width:300px;padding:8px;background:#111;color:#ddd;border:1px solid #333;font:12px monospace}
#nyx-gui *{border-radius:0!important;font:inherit}
#nyx-gui label{display:flex;justify-content:space-between;align-items:center;margin:3px 0}
#nyx-gui h4{margin:8px 0 2px;padding-top:4px;border-top:1px solid #333;color:#888;font-weight:400}
#nyx-gui input[type=color]{width:40px;height:18px;padding:0;border:1px solid #333;background:none}
#nyx-gui input[type=range]{width:90px}
#nyx-gui button{width:100%;margin-top:6px;padding:4px;background:#222;color:#ddd;border:1px solid #333;cursor:pointer}
#nyx-gui{max-height:calc(100vh - 32px);overflow:auto}
#nyx-gui label button{width:24px;margin:0;padding:1px}
#nyx-gui input[type=text]{width:110px;background:#222;color:#ddd;border:1px solid #333;padding:2px}
#nyx-gui select{width:110px;background:#222;color:#ddd;border:1px solid #333;padding:2px}
#nyx-gui details{margin:3px 0;border-top:1px solid #333;padding-top:2px}
#nyx-gui summary{cursor:pointer;color:#999;padding:2px 0;user-select:none}
#nyx-gui details[open]>summary{color:#ddd}
#nyx-gui[data-van] .nyx-nv{display:none}
#nyx-gui .nyx-pvw{position:sticky;top:0;z-index:3;background:#111;padding:2px 0 4px}
#nyx-gui .nyx-pv{padding:8px 10px;margin:4px 0;background:#313338;border:1px solid #333;font:16px/1.4 sans-serif;overflow:hidden}
#nyx-gui .nyx-pv small{display:block;color:#888;font:10px monospace;margin-bottom:4px}
#nyx-gui .nyx-fl{max-height:160px;overflow:auto;border:1px solid #333;margin:4px 0;background:#181818}
#nyx-gui .nyx-fr{padding:4px 8px;cursor:pointer;font-size:16px;white-space:nowrap;color:#ddd}
#nyx-gui .nyx-fr:hover{background:#222}
#nyx-gui .nyx-fr[data-on]{background:#2f3136;color:#fff;border-left:3px solid #5865f2}
.nyx-emo{height:1.375em;width:auto;vertical-align:-.3em}
.nyx-ics{display:inline-flex;gap:3px;margin-left:5px;vertical-align:middle;align-items:center}
.nyx-ic{height:1.2em;width:auto;font-size:1.1em;line-height:1}
.nyx-emo.nyx-big{height:48px;vertical-align:middle}
.nyx-stk{display:block;height:160px;width:auto}
[class*="repliedTextContent"] .nyx-emo{height:1.1em;vertical-align:-.2em}
[class*="repliedTextContent"] .nyx-stk{display:inline;height:1.4em;vertical-align:-.3em}
#nyx-layer{position:fixed;inset:0;pointer-events:none;z-index:99998;overflow:hidden}
#nyx-layer .nyx-deco{position:absolute;left:0;top:0;display:none;pointer-events:none;transform-origin:0 0;will-change:transform}
.nyx-sl{position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:3}
.nyx-sd{position:absolute;display:none;max-width:none;max-height:none;pointer-events:none}
#nyx-editor{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100001;width:344px;max-height:92vh;overflow:auto;padding:12px;background:#111;color:#ddd;border:1px solid #333;font:12px monospace;box-shadow:0 8px 40px rgba(0,0,0,.6)}
#nyx-editor *{font:inherit;box-sizing:border-box}
#nyx-editor summary{cursor:pointer;color:#aaa;margin-top:8px;user-select:none}
#nyx-editor .nyx-hint{color:#777;margin-bottom:6px}
#nyx-editor .nyx-frame{position:relative;overflow:hidden;isolation:isolate;background:#222;outline:1px solid #444;cursor:grab;user-select:none;touch-action:none}
#nyx-editor .nyx-frame:active{cursor:grabbing}
#nyx-editor label{display:flex;justify-content:space-between;align-items:center;margin:6px 0 0}
#nyx-editor input[type=range]{width:200px}
#nyx-editor button{margin-top:6px;padding:4px 8px;background:#222;color:#ddd;border:1px solid #333;cursor:pointer}
#nyx-editor .nyx-done{width:100%;margin-top:14px}`;

    function css() {
        const A = 'html[data-nyx-on] ', V = 'html[data-nyx-on]:not([data-nyx-van]) ', M = '[id^="message-content-"]', { enc: e, plain: p, file: f } = cfg;
        const bx = x => `background:${rgba(x.bg, x.ba)};opacity:${x.op / 100}`;
        const H = cfg.sp.hov ? ':not(:hover)' : '', SQ = `${V}[data-nyx-sp]:not([data-nyx-rev])${H}`;
        const MN = 'html[data-nyx-on][data-nyx-hide][data-nyx-min] li[data-nyx-kind="plain"]:not([data-nyx-open])';
        const MO = 'html[data-nyx-on][data-nyx-hide][data-nyx-min] li[data-nyx-kind="plain"][data-nyx-open]';
        return BASE
            + `${V}[data-nyx-enc]{color:${e.fg}!important;${bx(e)}}`
            + `${V}${M}:not([data-nyx-enc]){${p.fg !== D.plain.fg ? `color:${p.fg}!important;` : ''}${bx(p)}}`
            + `${A}.nyx-file{display:block;width:fit-content;max-width:100%;line-height:0}`
            + `${V}.nyx-file{${cfg.fnb ? 'padding:0;' : `padding:3px;border:2px solid ${f.fg};`}${bx(f)}}`
            // per-user font + color (from each user's bio payload)
            + `${V}[data-nyx-ft] *{font-family:inherit!important}`
            + `${V}[data-nyx-uc],${V}[data-nyx-uc] *,#nyx-gui [data-nyx-uc]{color:var(--nyx-uc)!important;-webkit-text-fill-color:var(--nyx-uc)!important}`
            + `${V}[data-nyx-uc],#nyx-gui [data-nyx-uc]{background-image:none!important}`
            + `${V}[data-nyx-tc],${V}[data-nyx-tc] *{color:var(--nyx-tc)!important}`
            // status bubble (thought bubble on profile cards): custom body + text color
            + `${V}[data-nyx-sbp]::before,${V}[data-nyx-sbp]::after{background-color:var(--nyx-sb)!important}`
            + `${V}[data-nyx-sbt],${V}[data-nyx-sbt] *{color:var(--nyx-sx)!important;-webkit-text-fill-color:var(--nyx-sx)!important}`
            // username gradient (u=/v= with two colors): gradient painted on the name element, clipped to the text
            + `${V}[data-nyx-ug],#nyx-gui [data-nyx-ug]{background-image:var(--nyx-ug)!important;-webkit-background-clip:text!important;background-clip:text!important}`
            + `${V}[data-nyx-ug],${V}[data-nyx-ug] *,#nyx-gui [data-nyx-ug],#nyx-gui [data-nyx-ug] *{color:transparent!important;-webkit-text-fill-color:transparent!important}`
            // loop = flowing gradient: image is 2x wide (c1>c2>c1) and slides exactly one period, so the wrap is seamless
            + `${V}[data-nyx-ul],#nyx-gui [data-nyx-ul]{background-size:200% 100%!important;background-repeat:repeat!important;animation:nyxflow var(--nyx-sp,3s) linear infinite}`
            + `@keyframes nyxflow{to{background-position:200% 0}}`
            // glow: drop-shadow works on gradient-clipped text too (text-shadow would not)
            + `${V}[data-nyx-gw],#nyx-gui [data-nyx-gw]{filter:drop-shadow(var(--nyx-gw)) drop-shadow(var(--nyx-gw))}`
            // custom status hidden for users who set s=0 in their bio payload
            + `${V}svg[data-nyx-hs] rect[mask*="status" i],${V}svg[data-nyx-hs] [class*="status" i]:not(foreignObject):not(img){display:none!important}`
            + `${V}svg[data-nyx-hs] foreignObject{mask:none!important;-webkit-mask:none!important}`
            + `${SQ}{background:#000!important;background-clip:border-box!important;color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;border-radius:0!important;cursor:pointer!important;user-select:none!important}`
            + `${SQ} *{visibility:hidden!important}`
            + `${SQ}[data-nyx-sp="nm"]{flex:none!important;width:fit-content!important;max-width:100%!important}`
            + (cfg.stag ? `${V}[data-nyx-tg],${V}[class*="chipletContainer"],${V}[class*="guildTag"],${V}[class*="clanTag"]{display:none!important}` : '')
            + (pfpOn() ? `${V}img[src*="/avatars/"]:not([data-nyx-pf]){visibility:hidden!important}` : '')
            + `${V}img[data-nyx-sp]:not([data-nyx-rev])${H},${V}video[data-nyx-sp]:not([data-nyx-rev])${H}{filter:brightness(0)!important}`
            + `html[data-nyx-on][data-nyx-hide]:not([data-nyx-min]) li[data-nyx-kind="plain"]{display:none!important}`
            // minimized: one-line stub, click to expand
            + `${MN}{position:relative;height:20px!important;min-height:0!important;margin:0!important;overflow:hidden!important;cursor:pointer}`
            + `${MN}>*{visibility:hidden!important}`
            + `${MN}::before{content:"message hidden - click to show";position:absolute;left:16px;top:0;font:11px/20px monospace;color:#6d6f78}`
            // expanded: small "hide" label bottom-right, click it to collapse back to the stub
            + `${MO}{position:relative}`
            + `${MO}::after{content:"hide";position:absolute;right:16px;bottom:3px;padding:0 6px;font:11px/18px monospace;color:#6d6f78;background:#111;border:1px solid #333;cursor:pointer;z-index:5}`
            + `${MO}::after:hover{color:#ddd}`;
    }

    // google fonts fetched through GM_xmlhttpRequest (page CSP can't block it) and registered as FontFace from raw bytes
    const webFonts = new Map();
    function loadWebFont(name) {
        name = name.replace(/["'\\;{}<>]/g, '').trim();
        if (!name) return;
        if (webFonts.has(name)) return webFonts.get(name);
        const p = (async () => {
            const css = new TextDecoder().decode(await gmGet('https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + '&display=swap'));
            let blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)].map(m => ({ label: m[1], body: m[2] }));
            if (blocks.length) blocks = blocks.filter(b => /^latin(-ext)?$/.test(b.label));
            else blocks = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].slice(0, 2).map(m => ({ body: m[1] }));
            for (const b of blocks) {
                const u = /url\(([^)]+)\)/.exec(b.body); if (!u) continue;
                const g = k => ((new RegExp(k + '\\s*:\\s*([^;]+)').exec(b.body)) || [])[1];
                const face = new FontFace(name, await gmGet(u[1].replace(/["']/g, '')), { weight: g('font-weight') || '400', style: g('font-style') || 'normal', unicodeRange: g('unicode-range') || 'U+0-10FFFF' });
                document.fonts.add(await face.load());
            }
            return true;
        })().catch(e => { console.warn('[opsec] font not loaded (maybe it is just an installed font):', name, e.message || e); return false; });
        webFonts.set(name, p);
        return p;
    }
    // my own font name for the bio payload: custom box wins, then the dropdown (google "g:Name" or a system family)
    const fontName = () => {
        const c = (cfg.ufontc || '').replace(/["'\\;{}<>]/g, '').trim(), v = cfg.ufont || '';
        const n = c || (v.startsWith('g:') ? v.slice(2) : v.replace(/["']/g, '').split(',')[0].trim());
        return /^[\w \-]{1,40}$/.test(n) ? n : '';
    };
    const famOf = n => /^(monospace|serif|sans-serif|cursive|fantasy)$/.test(n) ? n : `"${n}",sans-serif`;
    function ensureFont() {
        if (cfg.vanilla) return;
        const n = fontName(); if (n) loadWebFont(n);
    }
    // apply someone's shared font + name color to a username element
    function userStyle(x, uid, card) { // card = profile popout/modal (uses the profile color), else chat/lists (chat color)
        const p = !cfg.vanilla && uid && profiles.get(uid);
        nameStyle(x, !p ? null : card
            ? { f: p.f, c: p.v, c2: p.v2, l: p.vl, sp: p.vs, g: p.vw, gn: p.vwn }
            : { f: p.f, c: p.u, c2: p.u2, l: p.ul, sp: p.us, g: p.uw, gn: p.uwn });
    }
    // s = { f: font, c/c2: color or gradient, l: flow, sp: speed 1-10, g/gn: glow color/size } ; null clears everything
    // gradient/color must sit on the element that directly holds the text: background-clip:text on a wrapper can render the nested text invisible
    function leafOf(x) {
        for (let i = 0; i < 4; i++) {
            const kids = [...x.children].filter(c => !c.classList.contains('nyx-ics'));
            if (kids.length !== 1 || [...x.childNodes].some(n => n.nodeType === 3 && n.nodeValue.trim())) break;
            x = kids[0];
        }
        return x;
    }
    function nameStyle(x, s) {
        x = leafOf(x); s = s || {}; const f = s.f, c = s.c, l = s.l, c2 = x.querySelector('svg,img,canvas') ? null : s.c2; // gradient falls back to solid if the target holds media
        if (f) { x.style.setProperty('font-family', famOf(f), 'important'); x.dataset.nyxFt = '1'; loadWebFont(f); }
        else if (x.dataset.nyxFt) { x.style.removeProperty('font-family'); delete x.dataset.nyxFt; }
        if (c && c2) { x.style.setProperty('--nyx-ug', `linear-gradient(90deg,${c},${c2}${l ? ',' + c : ''})`); x.setAttribute('data-nyx-ug', ''); x.toggleAttribute('data-nyx-ul', !!l); x.style.setProperty('--nyx-sp', (12 / (s.sp || 4)).toFixed(2) + 's'); }
        else if (x.hasAttribute('data-nyx-ug')) { x.style.removeProperty('--nyx-ug'); x.style.removeProperty('--nyx-sp'); x.removeAttribute('data-nyx-ug'); x.removeAttribute('data-nyx-ul'); }
        if (c && !c2) { x.style.setProperty('--nyx-uc', c); x.setAttribute('data-nyx-uc', ''); }
        else if (x.hasAttribute('data-nyx-uc')) { x.style.removeProperty('--nyx-uc'); x.removeAttribute('data-nyx-uc'); }
        if (s.g) { x.style.setProperty('--nyx-gw', `0 0 ${s.gn || 8}px ${s.g}`); x.setAttribute('data-nyx-gw', ''); }
        else if (x.hasAttribute('data-nyx-gw')) { x.style.removeProperty('--nyx-gw'); x.removeAttribute('data-nyx-gw'); }
    }

    const st = el('style');
    document.documentElement.append(st);
    function apply() {
        st.textContent = css();
        const h = document.documentElement;
        h.toggleAttribute('data-nyx-on', enabled);
        h.toggleAttribute('data-nyx-hide', cfg.hide);
        h.toggleAttribute('data-nyx-min', !!cfg.min);
        h.toggleAttribute('data-nyx-van', !!cfg.vanilla);
        ensureFont();
    }
    apply();

    // ─── Incoming ─────────────────────────────────────────────────────────────
    const MSG = '[id^="message-content-"], [class*="repliedTextContent"]';
    const LI = 'li[id^="chat-messages-"]';
    const AV_SEL = 'img[src*="/avatars/"], img[data-nyx-uid], img[data-nyx-pf]';

    function gmGet(url) {
        return new Promise((res, rej) => GM_xmlhttpRequest({
            method: 'GET', url, responseType: 'arraybuffer', timeout: 25000,
            onload: r => (r.status >= 200 && r.status < 300) ? res(r.response) : rej(new Error('HTTP ' + r.status)),
            onerror: () => rej(new Error('network error')), ontimeout: () => rej(new Error('timeout'))
        }));
    }
    const mediaCache = new Map();
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
            if (x && x.nodeType === 1 && x.hasAttribute('data-nyx-x')) x.remove();
            orig.set(n, n.nodeValue); n.nodeValue = decode(n.nodeValue); hit = true;
            emojify(n);
        }
        if (hit) {
            e.setAttribute('data-nyx-enc', '');
            if (e.id && e.id.startsWith('message-content-')) jumbo(e);
        }
    }

    // editing: discord puts the raw cipher into the edit box. swap it for readable text; saving re-encrypts via the fetch hook.
    const EDITOR = '[data-slate-editor="true"], [role="textbox"][contenteditable="true"]';
    const unexpand = t => t.replace(/\{nyx\|(?:([es])\|(\d+)\|([a-z]{3,4})|u\|([\w:.\-\/]+))\}/g, (m, ty, id, x, ref) => {
        const e = cfg.lib.find(l => ref ? (l.t === 'u' && l.id === ref) : (l.t === ty && l.id === id));
        return e ? `:${e.n}:` : m;
    });
    const edText = ed => (ed.innerText || ed.textContent || '').replace(/[\u200b\ufeff]/g, '');
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
        const nid = li.id.split('-').pop(), own = sent.has(nid), mine = plain.has(nid);
        if (own && !mine) li.querySelectorAll('[id^="message-content-"]').forEach(c => c.setAttribute('data-nyx-enc', ''));
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
            card.style.display = 'none';
            loadMedia(a.href, ext).then(r => {
                if (enabled && card.isConnected && card.dataset.nyxMedia === tok) { const w = renderMedia(r.url, r.ext); card.parentElement.insertBefore(w, card); markSp(w.parentElement); }
            }).catch(err => {
                if (card.dataset.nyxMedia === tok) card.style.display = '';
                console.warn('[opsec] could not decrypt attachment', err);
            });
        });
        if (pfpOn() || (profiles.size && !cfg.vanilla)) li.querySelectorAll(AV_SEL).forEach(i => { if (pfpOn()) pfpReplace(i); else avaReplace(i); if (!cfg.vanilla) trackImg(i); });
        if (!cfg.vanilla && profiles.size) iconsFor(li);
        markSp(li);
        markTags(li);
        const ed0 = li.querySelector(EDITOR);
        if (!ed0) delete li.dataset.nyxEdit;
        else if (!li.dataset.nyxEdit && fixEditor(ed0)) li.dataset.nyxEdit = '1';
        const editing = !!li.querySelector(EDITOR);
        const kind = (own || mine || media || editing || li.querySelector('[id^="message-content-"][data-nyx-enc]')) ? 'enc' : 'plain';
        li.dataset.nyxKind = kind;
        if (kind === 'enc') li.removeAttribute('data-nyx-open');
    }

    const scanAll = () => document.querySelectorAll(LI).forEach(processLi);

    // minimized normal messages: click the stub to expand it, click the "hide" label (bottom-right of the expanded message) to collapse it again
    document.addEventListener('click', ev => {
        if (!enabled || !cfg.hide || !cfg.min || !ev.target.closest) return;
        const t = ev.target;
        if (t.matches && t.matches('li[data-nyx-kind="plain"][data-nyx-open]')) {
            const r = t.getBoundingClientRect();
            if (ev.clientX >= r.right - 64 && ev.clientX <= r.right - 12 && ev.clientY >= r.bottom - 26 && ev.clientY <= r.bottom) {
                ev.preventDefault(); ev.stopPropagation();
                t.removeAttribute('data-nyx-open');
            }
            return;
        }
        const l = t.closest('li[data-nyx-kind="plain"]:not([data-nyx-open])');
        if (!l) return;
        ev.preventDefault(); ev.stopPropagation();
        l.setAttribute('data-nyx-open', '');
    }, true);

    const OWN = '#nyx-gui,#nyx-editor,#nyx-layer,.nyx-cv,.nyx-file,[data-nyx-x],.nyx-ics,.nyx-sl';
    const isOwn = n => { const e = n.nodeType === 1 ? n : n.parentElement; return !!(e && e.closest && e.closest(OWN)); };

    new MutationObserver(ms => {
        if (!enabled) return;
        const lis = new Set();
        let touched = false, hot = false;
        const add = n => {
            if (!n || n.nodeType !== 1 || isOwn(n)) return;
            touched = true;
            markNames(n); markTags(n);
            if (n.matches('[role="dialog"], ' + PROF) || n.querySelector('[role="dialog"], ' + PROF)) hot = true;
            const li = n.closest(LI);
            if (li) lis.add(li); else n.querySelectorAll(LI).forEach(x => lis.add(x));
        };
        for (const m of ms) {
            if (m.type === 'characterData') {
                const pe = m.target.parentElement;
                if (pe && !isOwn(pe)) { const li = pe.closest(LI); if (li) lis.add(li); }
            } else if (m.type === 'attributes') {
                const t = m.target;
                if (t.src && !t.src.startsWith('blob:') && !isOwn(t)) {
                    touched = true;
                    markNames(t);
                    const li = t.closest(LI); if (li) lis.add(li);
                    if (t.closest('[role="dialog"], ' + PROF)) hot = true;
                }
            } else m.addedNodes.forEach(add);
        }
        lis.forEach(processLi);
        if (hot) { try { applyProfiles(); } catch (e) {} } else if (touched) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src'] });

    // ─── Gui helpers ──────────────────────────────────────────────────────────
    function revertProfiles() {
        document.querySelectorAll('img[data-nyx-oa]').forEach(avaRestore);
        decos.forEach(r => r.d.remove()); decos.clear();
        document.querySelectorAll('.nyx-sl').forEach(x => x.remove());
        document.querySelectorAll('.nyx-ics').forEach(x => x.remove());
        document.querySelectorAll('.nyx-cv').forEach(x => { if (!x.closest('#nyx-editor')) x.remove(); });
        document.querySelectorAll('[data-nyx-hs]').forEach(x => x.removeAttribute('data-nyx-hs'));
        document.querySelectorAll('[data-nyx-ft],[data-nyx-uc],[data-nyx-ug],[data-nyx-gw]').forEach(x => { if (!x.closest('#nyx-gui')) nameStyle(x, null); });
        document.querySelectorAll('[data-nyx-bak]').forEach(x => { x.setAttribute('style', x.dataset.nyxBak); delete x.dataset.nyxBak; delete x.dataset.nyxTh; delete x.dataset.nyxTc; });
    }
    function revert() {
        revertProfiles();
        document.querySelectorAll('[data-nyx-x]').forEach(x => x.remove());
        document.querySelectorAll('[data-nyx-enc]').forEach(e => {
            const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            let n;
            while ((n = w.nextNode())) if (orig.has(n)) n.nodeValue = orig.get(n);
            e.removeAttribute('data-nyx-enc');
        });
        document.querySelectorAll('.nyx-file').forEach(x => x.remove());
        document.querySelectorAll('[data-nyx-media]').forEach(c => { c.style.display = ''; delete c.dataset.nyxMedia; });
        document.querySelectorAll('[data-nyx-kind]').forEach(l => { delete l.dataset.nyxKind; l.removeAttribute('data-nyx-open'); });
    }

    function setEnabled(v) {
        enabled = v;
        apply();
        const b = document.getElementById('nyx-en'); if (b) b.textContent = v ? 'on' : 'off';
        if (v) { scanAll(); profiles.forEach(prefetch); applyProfiles(); } else revert();
    }

    function setVanilla(v) {
        cfg.vanilla = !!v; save(); apply();
        if (v) revertProfiles();
        if (enabled) { applySp(); if (!v) scanAll(); }
        if (gui) gui.toggleAttribute('data-van', !!v);
        const c = document.getElementById('nyx-van'); if (c) c.checked = !!v;
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

    // ─── Spoilers ─────────────────────────────────────────────────────────────
    const UNSEL = 'h3 [class*="username"], [class*="repliedMessage"] [class*="username"]';
    function markSp(root) {
        if (cfg.vanilla) return;
        const S = cfg.sp, set = (x, k) => { if (!x.hasAttribute('data-nyx-sp')) x.setAttribute('data-nyx-sp', k); };
        if (nmOn()) root.querySelectorAll(UNSEL).forEach(x => { if (!(x.parentElement && x.parentElement.closest('[class*="username"]'))) set(x, 'un'); });
        if (S.on && S.att) root.querySelectorAll('.nyx-file, [id^="message-accessories-"] img:not(.nyx-file img), [id^="message-accessories-"] video:not(.nyx-file video)').forEach(x => set(x, 'att'));
        if (S.on && S.emo) root.querySelectorAll('img.nyx-emo, img.nyx-stk, [id^="message-content-"] img[class*="emoji"]').forEach(x => set(x, 'emo'));
    }
    function applySp() {
        const S = cfg.sp, v = S.on && !cfg.vanilla, on = { att: v && S.att, emo: v && S.emo, pn: v && S.pdn, pu: v && S.pun, pb: v && S.pbio, un: nmOn(), nm: nmOn() };
        document.querySelectorAll('[data-nyx-sp]').forEach(x => { if (!on[x.getAttribute('data-nyx-sp')]) { x.removeAttribute('data-nyx-sp'); x.removeAttribute('data-nyx-rev'); } });
        if (enabled) { markSp(document); applyProfiles(); }
    }
    document.addEventListener('click', ev => {
        if (!enabled || cfg.vanilla || cfg.sp.hov || !ev.target.closest) return;
        const t = ev.target.closest('[data-nyx-sp]:not([data-nyx-rev])');
        if (!t) return;
        ev.preventDefault(); ev.stopPropagation();
        t.setAttribute('data-nyx-rev', '');
    }, true);

    // ─── Server tags (clan badges) ────────────────────────────────────────────
    function markTags(root) {
        if (!cfg.stag || cfg.vanilla || !root.querySelectorAll) return;
        root.querySelectorAll('img[src*="clan-badges"], img[src*="guild-tag"]').forEach(i => {
            const c = i.closest('[class*="chiplet"], [class*="guildTag"], [class*="clanTag"], [class*="serverTag"]') || i.parentElement;
            if (c && !c.hasAttribute('data-nyx-tg')) c.setAttribute('data-nyx-tg', '');
        });
    }

    // ─── Custom icons + shared font/color next to usernames ───────────────────
    function makeIcons(ics, key) {
        const w = el('span', { className: 'nyx-ics' });
        w.dataset.k = key;
        ics.slice(0, 3).forEach(r => {
            if (r.startsWith('x:')) {
                let t = ''; try { t = String.fromCodePoint(...r.slice(2).split('-').map(h => parseInt(h, 16)).filter(n => n > 0 && n < 0x110000)); } catch (e) {}
                if (t) w.append(el('span', { className: 'nyx-ic', textContent: t }));
            } else {
                const i = el('img', { className: 'nyx-ic', draggable: false }), u = blobUrls.get(r);
                if (u) i.src = u; else refBlob(r).then(x => { i.src = x; }).catch(() => {});
                w.append(i);
            }
        });
        return w;
    }
    function nameAnchor(h3) {
        let un = [...h3.querySelectorAll('[class*="username" i]')].find(x => !x.closest('.nyx-ics'));
        if (!un) un = [...h3.querySelectorAll('span')].find(x => !x.closest('time,[class*="timestamp" i],.nyx-ics') && !x.querySelector('span,time,img') && x.textContent.trim());
        while (un && un.parentElement && un.parentElement !== h3 && /username/i.test(un.parentElement.getAttribute('class') || '')) un = un.parentElement;
        return un;
    }
    function iconsFor(li) {
        const av = [...li.querySelectorAll(AV_SEL)].find(i => !i.closest('[class*="repliedMessage"]'));
        const uid = av && avUid(av), p = uid && profiles.get(uid), ics = p && p.ic && p.ic.length ? p.ic : null;
        const h3 = li.querySelector('h3'), un = h3 && nameAnchor(h3);
        if (un) userStyle(un, uid);
        replyStyle(li);
        const key = ics ? uid + '|' + ics.join(',') : '', old = li.querySelector('.nyx-ics');
        if (old && old.dataset.k === key && old.isConnected) return;
        if (old) old.remove();
        if (!key || !h3) return;
        const w = makeIcons(ics, key);
        if (un) un.after(w); else h3.append(w);
        log('icons placed', uid, ics);
    }

    // ─── Fake profiles: payload hidden in the bio as invisible unicode tag chars ─
    // payload text: nyx;c=RRGGBB,RRGGBB;t=RRGGBB;u=RRGGBB;s=0;f=Font+Name;ic=<a>,<b>,<c>;b=<ref>;bp=x,y,z;d=<ref>;dp=dx,dy,s;a=<ref>;ap=x,y,z
    //   or, with "short bio": nyx;p=c:<catbox file>;  (the full payload text lives in that catbox file)
    //   u = chat/list username color (overrides role color), v = username color on the profile card, f = username font ('+' = space)
    //   u and v take one color (RRGGBB) or two (RRGGBB,RRGGBB) = left-to-right gradient; ul=1 / vl=1 makes that gradient flow (loop), us= / vs= = flow speed 1-10
    //   uw= / vw= = name glow: RRGGBB or RRGGBB,size (size 1-20 px)
    //   s=0 = hide this user's online/idle/dnd dot on their avatar (profile card + member/DM lists) for everyone running the script
    const profiles = new Map(Object.entries(cfg.known || {}));
    const names = new Map(Object.entries(cfg.names || {}));
    let lastProf = null;
    const PROFILE_URL = /\/users\/\d+\/profile(\?|$)/;
    const PROF = '.user-profile-popout, .user-profile-modal, [class*="userPopoutOuter"], [class*="userProfileOuter"], [class*="userPopout_"], [class*="userProfileModal"]';
    const tagEnc = t => [...t.replace(/[^\x20-\x7e]/g, '')].map(c => String.fromCodePoint(0xE0000 + c.charCodeAt(0))).join('');
    const tagDec = t => { let o = ''; for (const ch of t) { const c = ch.codePointAt(0); if (c >= 0xE0020 && c <= 0xE007E) o += String.fromCharCode(c - 0xE0000); } return o; };
    const uidOf = u => (/\/users\/(\d+)\/|\/(?:avatars|banners)\/(\d+)\//.exec(u || '') || []).slice(1).find(Boolean);
    const avUid = img => uidOf(img.src) || (img.src.startsWith('blob:') ? img.dataset.nyxUid : undefined);
    const bak = x => { if (!('nyxBak' in x.dataset)) x.dataset.nyxBak = x.getAttribute('style') || ''; };
    const T = (p, k, d) => (Array.isArray(p[k]) && p[k].length === 3) ? p[k] : d;
    const tri = (s, d) => { const m = /^(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(s || ''); return m ? [+m[1], +m[2], +m[3]] : d.slice(); };
    const same = (t, d) => !t || t.every((v, i) => Math.round(v) === d[i]);

    function parseText(t) {
        if (!t.startsWith('nyx;')) return null;
        const o = {};
        t.split(';').slice(1).forEach(kv => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i)] = kv.slice(i + 1); });
        const c = /^([0-9a-f]{6}),([0-9a-f]{6})$/i.exec(o.c || '');
        const hx = s => { const m = /^([0-9a-f]{6})(?:,([0-9a-f]{6}))?$/i.exec(s || ''); return m ? ['#' + m[1], m[2] ? '#' + m[2] : null] : [null, null]; };
        const [u1, u2] = hx(o.u), [v1, v2] = hx(o.v), [sb1] = hx(o.sb), [sx1] = hx(o.sx);
        const gw = s => { const m = /^([0-9a-f]{6})(?:,(\d{1,2}))?$/i.exec(s || ''); return m ? ['#' + m[1], Math.min(20, Math.max(1, +m[2] || 8))] : [null, 8]; };
        const [uw, uwn] = gw(o.uw), [vw, vwn] = gw(o.vw), spd = s => Math.min(10, Math.max(1, +s || 4));
        return { hs: o.s === '0', sb: sb1, sx: sx1, ptr: /^c:[\w.\-]+$/.test(o.p || '') ? o.p : '', t: /^[0-9a-f]{6}$/i.test(o.t || '') ? '#' + o.t : null, u: u1, u2, v: v1, v2, ul: o.ul === '1', vl: o.vl === '1', us: spd(o.us), vs: spd(o.vs), uw, uwn, vw, vwn, f: /^[\w+\-]{1,40}$/.test(o.f || '') ? o.f.replace(/\+/g, ' ') : '', c: c ? ['#' + c[1], '#' + c[2]] : null, b: o.b || '', d: o.d || '', a: o.a || '', ic: (o.ic || '').split(',').filter(Boolean).slice(0, 3), bp: tri(o.bp, BP), ap: tri(o.ap, AP), dp: tri(o.dp, DP) };
    }
    function parsePayload(bio) {
        let t = tagDec(bio || '');
        if (!t.startsWith('nyx;')) { const v = /nyx;[\w=,;:.\-\/%~+]*/.exec(bio || ''); t = v ? v[0] : ''; }
        return parseText(t);
    }

    const ptrCache = new Map();
    function resolvePtr(ref) {
        if (!ptrCache.has(ref)) ptrCache.set(ref, refBuf(ref).then(b => parseText(new TextDecoder().decode(b).slice(0, 4000).trim())).catch(e => { ptrCache.delete(ref); throw e; }));
        return ptrCache.get(ref);
    }
    // upload any blob to catbox -> resolves the public https url (used for short bios and local file uploads)
    // upload bytes (Uint8Array) -> public https url. imgur first if a client id is set (text/base64 body, no binary transport),
    // else catbox, trying several body encodings; every catbox attempt is downloaded back and size-checked.
    async function uploadBlob(bytes, name) {
        const fn = (name || 'file.bin').replace(/[^\w.\-]/g, '_'), ty = MIME[(/\.(\w+)$/.exec(fn) || [])[1]] || 'application/octet-stream', enc = new TextEncoder(), notes = [];
        const bin = u => { let t = ''; for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return t; };
        const post = o => new Promise((res, rej) => GM_xmlhttpRequest({ method: 'POST', timeout: 120000, ...o, onload: res, onerror: () => rej(new Error('network error')), ontimeout: () => rej(new Error('timeout')) }));
        const bd = '----nyx' + Math.random().toString(16).slice(2);
        const all = cat([enc.encode(`--${bd}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n--${bd}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${fn}"\r\nContent-Type: ${ty}\r\n\r\n`), bytes, enc.encode(`\r\n--${bd}--\r\n`)]);
        const mp = { 'Content-Type': 'multipart/form-data; boundary=' + bd };
        const form = f => { const fd = new FormData(); fd.append('reqtype', 'fileupload'); fd.append('fileToUpload', f, fn); return { data: fd }; };
        const tries = [
            ['blob', () => ({ headers: mp, data: new Blob([all]) })],
            ['binary', () => ({ headers: mp, data: bin(all), binary: true })],
            ['form', () => form(new Blob([bytes], { type: ty }))],
            ['file', () => form(new File([bytes], fn, { type: ty }))],
            ['buffer', () => ({ headers: mp, data: all.buffer })],
            ['fetch', () => ({ headers: mp, data: new Blob([all]), fetch: true })]
        ];
        let shown = 0;
        for (const [label, mk] of tries) {
            try {
                const r = await post({ url: 'https://catbox.moe/user/api.php', ...mk() }), m = /https:\/\/files\.catbox\.moe\/[\w.\-]+/.exec(r.responseText || '');
                if (!m) { notes.push(`${label}: HTTP ${r.status} ${(r.responseText || '').trim().slice(0, 40) || 'empty'}`); continue; }
                const n = (await gmGet(m[0])).byteLength;
                if (n === bytes.length) return m[0];
                notes.push(`${label}: stored ${n}` + (shown++ ? '' : ' ' + m[0]));
            } catch (e) { notes.push(`${label}: ${e.message || e}`); }
        }
        try { // diagnosis: does catbox keep a tiny text file? (no = catbox itself is broken for you, not the file transport)
            const r = await post({ url: 'https://catbox.moe/user/api.php', ...form(new Blob(['nyx-test'], { type: 'text/plain' })) }), m = /https:\/\/files\.catbox\.moe\/[\w.\-]+/.exec(r.responseText || '');
            notes.push('8-byte text test: ' + (m ? 'stored ' + (await gmGet(m[0])).byteLength + '/8' : 'no url'));
        } catch (e) { notes.push('text test: ' + (e.message || e)); }
        throw new Error(notes.join(' | ') + ` (file is ${bytes.length} bytes).`);
    }
    // pc uploads for images go to basepic.com (free, no key/account, permanent unless deleted). base64 text body = no binary transport
    async function uploadImage(bytes, name) {
        let t = ''; for (let i = 0; i < bytes.length; i += 0x8000) t += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        const bd = '----nyx' + Math.random().toString(16).slice(2), fn = (name || 'image').replace(/[^\w.\-]/g, '_');
        const r = await new Promise((res, rej) => GM_xmlhttpRequest({
            method: 'POST', url: 'https://basepic.com/api/v1/images', timeout: 180000,
            headers: { 'Content-Type': 'multipart/form-data; boundary=' + bd },
            data: `--${bd}\r\nContent-Disposition: form-data; name="image"\r\n\r\n${btoa(t)}\r\n--${bd}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${fn}\r\n--${bd}--\r\n`,
            onload: res, onerror: () => rej(new Error('network error')), ontimeout: () => rej(new Error('timeout'))
        }));
        let j = {}; try { j = JSON.parse(r.responseText || '{}'); } catch (e) {}
        const u = j.image_url || (j.data && (j.data.image_url || j.data.url));
        if (/^https?:\/\//.test(u || '')) return u.replace(/^http:/, 'https:');
        throw new Error('basepic: HTTP ' + r.status + ' ' + (r.responseText || '').slice(0, 100));
    }
    const uploadText = t => uploadBlob(new TextEncoder().encode(t), 'p.txt');
    // read a picked file as bytes via a data url (a plain string, so nothing odd can happen across script/page realms)
    const readBytes = f => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => { const t = atob(String(r.result).split(',')[1] || ''), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); res(u); };
        r.onerror = () => rej(new Error('could not read file'));
        r.readAsDataURL(f);
    });
    // pick a file from the pc, strip metadata (if enabled), upload it, hand the public url to cb
    function pickFile(accept, cb) {
        const i = el('input', { type: 'file', accept });
        i.onchange = async () => {
            const f = i.files[0]; if (!f) return;
            try {
                let data = await readBytes(f);
                if (!data.length) throw new Error('file read as empty');
                if (cfg.strip) { // keep the stripped copy only if it still decodes as an image
                    const s = new Uint8Array(stripMeta(data.buffer));
                    try { await createImageBitmap(new Blob([s])); data = s; } catch (e) { log('strip skipped, kept original', e); }
                }
                cb(await uploadImage(data, f.name), f);
            } catch (e) { alert('upload failed: ' + (e.message || e)); }
        };
        i.click();
    }
    async function makeBio() {
        await resolveTenorProf();
        const full = genPayload(true), inline = tagEnc(full);
        if (!cfg.ptr || inline.length <= 40) return { t: inline };
        try {
            const t = tagEnc('nyx;p=' + shorten(await uploadText(full), false) + ';');
            return t.length < inline.length ? { t, p: 1 } : { t: inline };
        } catch (e) { return { t: inline, w: 'upload failed (' + (e.message || e) + '), used the long inline version' }; }
    }

    const prefetch = p => {
        [p.d, ...(p.ic || [])].forEach(r => { if (r && !r.startsWith('x:')) refBlob(r).catch(() => {}); });
        if (p.a) avatarSrc(p.a, T(p, 'ap', AP)).catch(() => {});
        if (p.f) loadWebFont(p.f);
    };

    function readProfile(j) {
        const id = j && j.user && j.user.id;
        if (!id) return;
        lastProf = id;
        const nm = { u: j.user.username || '', g: j.user.global_name || '', n: (j.guild_member && j.guild_member.nick) || (j.guild_member_profile && j.guild_member_profile.nick) || '' };
        names.set(id, nm); cfg.names[id] = nm;
        const nk = Object.keys(cfg.names); if (nk.length > 600) nk.slice(0, nk.length - 600).forEach(k => { delete cfg.names[k]; names.delete(k); });
        const bios = [j.user_profile && j.user_profile.bio, j.guild_member_profile && j.guild_member_profile.bio, j.user && j.user.bio];
        let p = null;
        for (const b of bios) { p = parsePayload(b); if (p) break; }
        log('profile fetched', id, p ? 'payload found' : 'no payload', p);
        const has = bios.some(b => typeof b === 'string');
        const fin = q => {
            if (q) { profiles.set(id, q); cfg.known[id] = q; if (enabled) prefetch(q); }
            else if (has) { profiles.delete(id); delete cfg.known[id]; }
            const ks = Object.keys(cfg.known);
            if (ks.length > 300) ks.slice(0, ks.length - 300).forEach(k => delete cfg.known[k]);
            save();
            if (enabled) schedule();
        };
        if (p && p.ptr) resolvePtr(p.ptr).then(q => fin(q ? { ...q, ptr: p.ptr } : p), e => { log('pointer failed', e); if (!profiles.has(id)) fin(p); });
        else fin(p);
    }

    function sniff(resource, p) {
        try {
            const u = typeof resource === 'string' ? resource : (resource && resource.url) || '';
            if (PROFILE_URL.test(u)) p.then(r => r.clone().json()).then(readProfile).catch(() => {});
        } catch (e) {}
        return p;
    }

    const HOSTS = { i: 'https://i.imgur.com/', c: 'https://files.catbox.moe/', t: 'https://media.tenor.com/', t1: 'https://media1.tenor.com/', tc: 'https://c.tenor.com/' };
    function shorten(u, b64) {
        u = u.trim();
        if (/^(i\.imgur\.com|files\.catbox\.moe)\//.test(u)) u = 'https://' + u;
        u = u.replace(/^http:/, 'https:');
        for (const k in HOSTS) if (u.startsWith(HOSTS[k])) return k + ':' + u.slice(HOSTS[k].length).split('?')[0];
        return b64 ? 'b:' + btoa(encodeURI(u)).replace(/\+/g, '-').replace(/\//g, '.').replace(/=+$/, '') : u;
    }
    const normRef = r => shorten((r || '').trim(), false);
    const refUrl = r => {
        const m = /^(\w+):(.*)$/.exec(r || '');
        if (m && HOSTS[m[1]]) return HOSTS[m[1]] + m[2];
        if (m && m[1] === 'b') { try { const u = decodeURI(atob(m[2].replace(/-/g, '+').replace(/[._]/g, '/'))); return /^https:\/\//.test(u) ? u : null; } catch (e) { return null; } }
        return /^https:\/\//.test(r || '') ? r : null;
    };
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

    const bufCache = new Map(), blobCache = new Map(), blobUrls = new Map(), bakeUrls = new Map();
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
                const u = URL.createObjectURL(new Blob([b], { type: sniffImg(b) || MIME[ext] || 'image/png' })); blobUrls.set(r, u); return u;
            }).catch(e => { blobCache.delete(r); throw e; }));
        }
        return blobCache.get(r);
    }

    // ─── Cover rendering (banner + editor frames) ─────────────────────────────
    const coverGeom = (nw, nh, fw, fh, z) => { const s = Math.max(fw / nw, fh / nh) * z / 100; return { w: nw * s, h: nh * s }; };
    const covers = new WeakMap();
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

    // ─── Avatar replacement ───────────────────────────────────────────────────
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
            const out = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); bakeUrls.set(k, out); return out;
        })().catch(e => { bakeCache.delete(k); throw e; }));
        return bakeCache.get(k);
    }

    function avaReplace(img) {
        if (cfg.vanilla) return;
        const uid = avUid(img), p = uid && profiles.get(uid);
        if (!p || !p.a) return;
        const t = T(p, 'ap', AP), want = p.a + '|' + t.map(Math.round).join(',');
        if (img.dataset.nyxAv === want && img.src.startsWith('blob:')) return;
        const put = u => {
            if (!enabled || cfg.vanilla || !img.isConnected) return;
            if (!img.src.startsWith('blob:')) img.dataset.nyxOa = img.src;
            img.dataset.nyxUid = uid; img.dataset.nyxAv = want;
            img.removeAttribute('srcset'); img.src = u;
        };
        const ready = same(t, AP) ? blobUrls.get(p.a) : bakeUrls.get(want);
        if (ready) return put(ready);
        avatarSrc(p.a, t).then(put).catch(e => console.warn('[opsec] avatar failed', e));
    }
    function avaRestore(img) {
        if (img.dataset.nyxOa) img.src = img.dataset.nyxOa;
        delete img.dataset.nyxOa; delete img.dataset.nyxUid; delete img.dataset.nyxAv; delete img.dataset.nyxPf; delete img.dataset.nyxPk;
    }

    // ─── Profile picture hiding ───────────────────────────────────────────────
    const pfpUrls = new Map();
    function pfpNum(pk) {
        if (!cfg.pnums[pk]) { cfg.pnums[pk] = cfg.pnext++; const ks = Object.keys(cfg.pnums); if (ks.length > 800) delete cfg.pnums[ks[0]]; save(); }
        return cfg.pnums[pk];
    }
    function pfpUrl(mode, pk) {
        const n = mode === 'black' ? 0 : pfpNum(pk), k = mode + '|' + pk;
        if (!pfpUrls.has(k)) {
            const bg = mode === 'black' ? '#000' : `hsl(${Math.round(n * 137.5) % 360},60%,40%)`;
            const txt = mode === 'number' ? `<text x="64" y="66" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${n > 99 ? 44 : n > 9 ? 56 : 68}" text-anchor="middle" dominant-baseline="central">${n}</text>` : '';
            pfpUrls.set(k, URL.createObjectURL(new Blob([`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="${bg}"/>${txt}</svg>`], { type: 'image/svg+xml' })));
        }
        return pfpUrls.get(k);
    }
    function pfpReplace(img) {
        const m = cfg.pfp, blob = img.src.startsWith('blob:');
        let pk;
        if (blob) pk = img.dataset.nyxPk || img.dataset.nyxUid;
        else { const u = avUid(img), d = /\/embed\/avatars\/(\d+)/.exec(img.src); pk = u || (d ? 'd' + d[1] : null); }
        if (!pk) return;
        const want = m + '|' + pk;
        if (blob && img.dataset.nyxPf === want) return;
        if (!blob) { img.dataset.nyxOa = img.src; const u = avUid(img); if (u) img.dataset.nyxUid = u; }
        img.dataset.nyxPk = pk; img.dataset.nyxPf = want; delete img.dataset.nyxAv;
        img.removeAttribute('srcset'); img.src = pfpUrl(m, pk);
    }

    // ─── Decorations ─────────────────────────────────────────────────────────
    const layer = el('div', { id: 'nyx-layer' });
    const decos = new Map();
    let raf = 0, frameN = 0;
    const mountLayer = () => { if (document.body && !layer.isConnected) document.body.append(layer); };

    function untrack(img) { const r = decos.get(img); if (r) { r.d.remove(); decos.delete(img); } }
    function scrollerOf(img) {
        if (img.closest('[role="dialog"], [class*="popout" i], ' + PROF)) return null;
        for (let e = img.parentElement; e && e !== document.body; e = e.parentElement) {
            if (e.matches('[class*="scroller"]') && /(auto|scroll)/.test(getComputedStyle(e).overflowY)) return e;
        }
        return null;
    }
    function trackImg(img) {
        if (!enabled) return;
        const uid = avUid(img), p = uid && profiles.get(uid);
        if (!p || !p.d) { untrack(img); return; }
        let r = decos.get(img);
        if (r && r.S && !r.S.isConnected) { untrack(img); r = null; }
        if (!r) {
            const S = scrollerOf(img), d = el('img', { className: S ? 'nyx-sd' : 'nyx-deco', draggable: false });
            if (S) {
                let L = [...S.children].find(c => c.classList && c.classList.contains('nyx-sl'));
                if (!L) {
                    L = el('div', { className: 'nyx-sl' });
                    bak(S);
                    if (getComputedStyle(S).position === 'static') S.style.position = 'relative';
                    S.append(L);
                }
                L.append(d);
            } else { mountLayer(); layer.append(d); }
            r = { d, p, S, ref: '', vis: undefined };
            decos.set(img, r);
        }
        r.p = p;
        if (r.ref !== p.d) {
            const ref = r.ref = p.d, u = blobUrls.get(ref);
            if (u) r.d.src = u;
            else refBlob(ref).then(x => { if (r.ref === ref) r.d.src = x; }).catch(e => console.warn('[opsec] decoration failed', e));
        }
        kick();
    }
    const catcher = (t, img) => {
        if (t.contains(img)) return false;
        const r = t.getBoundingClientRect();
        return r.width >= innerWidth * .9 && r.height >= innerHeight * .9 && alphaOf(getComputedStyle(t).backgroundColor) < .3;
    };
    function seen(img, r) {
        if (r.width < 6 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
        const g = ((img.closest('svg') || img).parentElement || {}).parentElement;
        for (const f of [[.5, .5], [.3, .3], [.7, .7]]) {
            const top = document.elementsFromPoint(r.left + r.width * f[0], r.top + r.height * f[1]).find(t => !catcher(t, img));
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
            if (!img.isConnected || (row.S && !row.S.isConnected)) { row.d.remove(); decos.delete(img); continue; }
            const r = img.getBoundingClientRect();
            if (!row.S && (row.vis === undefined || frameN % 5 === 0)) {
                const v = seen(img, r); row.miss = v ? 0 : (row.miss || 0) + 1;
                row.vis = row.vis === undefined ? v : (v || row.miss < 3);
            }
            rows.push([row, r]);
        }
        for (const [row, r] of rows) {
            const d = row.d, t = T(row.p, 'dp', DP), w = r.width * t[2] / 100;
            if (r.width < 6 || (!row.S && !row.vis) || !d.getAttribute('src')) { d.style.display = 'none'; continue; }
            const x = r.left + r.width / 2 + t[0] / 100 * r.width - w / 2, y = r.top + r.height / 2 + t[1] / 100 * r.width - w / 2;
            d.style.display = 'block';
            d.style.width = d.style.height = w + 'px';
            if (row.S) {
                const sr = row.S.getBoundingClientRect();
                d.style.left = x - sr.left - row.S.clientLeft + row.S.scrollLeft + 'px';
                d.style.top = y - sr.top - row.S.clientTop + row.S.scrollTop + 'px';
            } else d.style.transform = `translate(${x}px,${y}px)`;
        }
        raf = requestAnimationFrame(tick);
    }
    function kick() { if (!raf && enabled && decos.size) raf = requestAnimationFrame(tick); }

    // ─── Applying profiles to popouts + the full profile modal ───────────────
    let schedT = 0, lastRun = 0;
    function schedule() {
        if (schedT || !enabled) return;
        const wait = Math.max(0, 120 - (performance.now() - lastRun));
        schedT = setTimeout(() => { schedT = 0; lastRun = performance.now(); try { applyProfiles(); } catch (e) { console.warn('[opsec] apply error', e); } }, wait);
    }

    const big = x => { const r = x.getBoundingClientRect(); return r.width > innerWidth * .9 && r.height > innerHeight * .9; };

    function profileRoots() {
        const s = new Set(document.querySelectorAll(PROF));
        document.querySelectorAll('[role="dialog"]').forEach(d => {
            if (d.querySelector(AV_SEL) && d.querySelector('[class*="banner" i]')) s.add(d);
        });
        const all = [...s].filter(x => !big(x));
        return all.filter(x => !all.some(y => y !== x && y.contains(x)));
    }

    const alphaOf = bc => {
        if (!bc || bc === 'transparent') return 0;
        let m = /^rgba?\(([^)]+)\)$/.exec(bc);
        if (m) { const p = m[1].split(/[\s,\/]+/).filter(Boolean); if (p.length < 4) return 1; const v = parseFloat(p[3]); return /%/.test(p[3]) ? v / 100 : v; }
        m = /\/\s*([\d.]+)(%?)\s*\)$/.exec(bc);
        return m ? +m[1] / (m[2] ? 100 : 1) : 1;
    };
    const BADCLS = /button|icon|badge|pill|overlay|menu/i;
    const geoOK = (r, cr) => r.width >= cr.width * .85 && r.height >= 36 && r.height <= 340 && r.top >= cr.top - 4 && r.top <= cr.top + 30;

    function pickCard(c, av) {
        let card = null;
        for (let e = av; e; e = e.parentElement) {
            const r = e.getBoundingClientRect();
            if (r.width >= 200 && r.width <= innerWidth * .95 && !big(e)) card = e;
            if (e === c) break;
        }
        return card || c;
    }

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
        let best = null, area = 0;
        all.forEach(x => {
            const cl = x.getAttribute('class') || '';
            if (x instanceof SVGElement || x.closest('.nyx-cv') || !/banner/i.test(cl) || BADCLS.test(cl) || x.querySelector('[class*="banner" i]')) return;
            const r = x.getBoundingClientRect(), a = r.width * r.height;
            if (r.width >= 100 && r.height >= 30 && a >= area) { best = x; area = a; }
        });
        return best || (byGeo && byGeo.x);
    }

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
            if (done.some(t => t.contains(x))) continue;
            bak(x); x.dataset.nyxTh = 't'; done.push(x);
            x.style.setProperty('background', 'rgba(0,0,0,.35)', 'important');
        }
        log('painted gradient on', g.className, 'translucent panels:', done.length);
    }

    function unthemeCard(card) {
        [card, ...card.querySelectorAll('[data-nyx-bak]')].forEach(x => {
            if ('nyxBak' in x.dataset) { x.setAttribute('style', x.dataset.nyxBak); delete x.dataset.nyxBak; delete x.dataset.nyxTh; delete x.dataset.nyxTc; }
        });
        card.querySelectorAll('.nyx-cv, .nyx-ics').forEach(x => x.remove());
        card.querySelectorAll('[data-nyx-sbd],[data-nyx-sbp],[data-nyx-sbt]').forEach(x => { x.removeAttribute('data-nyx-sbd'); x.removeAttribute('data-nyx-sbp'); x.removeAttribute('data-nyx-sbt'); });
        card.querySelectorAll('[data-nyx-hs]').forEach(x => x.removeAttribute('data-nyx-hs'));
        card.querySelectorAll('[data-nyx-sp="pn"], [data-nyx-sp="pu"], [data-nyx-sp="pb"]').forEach(x => { x.removeAttribute('data-nyx-sp'); x.removeAttribute('data-nyx-rev'); });
    }

    const norm = t => t.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u2060\ufeff\u{e0000}-\u{e007f}]/gu, '').replace(/\s+/g, ' ').trim();
    function spSet(x, k) {
        if (x.closest('[data-nyx-sp]')) return;
        x.querySelectorAll('[data-nyx-sp]').forEach(y => { y.removeAttribute('data-nyx-sp'); y.removeAttribute('data-nyx-rev'); });
        x.setAttribute('data-nyx-sp', k);
    }

    // ─── Presence dot hiding (s=0 in the bio payload) ────────────────────────
    // marks the avatar's <svg> wrapper; css then drops the online/idle/dnd dot and the cutout it leaves in the avatar circle
    const setHs = (img, hide) => { const s = img.closest('svg'); if (s) s.toggleAttribute('data-nyx-hs', !!hide); };
    function rowOf(img) {
        let row = img.parentElement, best = null;
        for (let i = 0; row && i < 7; i++, row = row.parentElement) {
            if ([...row.querySelectorAll(AV_SEL)].some(a => a !== img)) break;
            best = row;
            if (row.matches('[data-list-item-id], [role="listitem"], [role="treeitem"], li')) break;
        }
        return best;
    }

    // ─── Usernames in lists (member list, DMs, account panel, voice...) ──────
    const NMBAD = '[class*="botTag"],[class*="chiplet"],[class*="clan"],[class*="badge" i],[class*="guildTag"],[class*="status" i],[class*="activity" i],[class*="subtext" i]';
    const nmDone = new WeakMap();
    let svT = 0;
    function learnName(uid, t) {
        const o = names.get(uid) || { u: '', g: '', n: '' };
        if (o.u === t || o.g === t || o.n === t) return;
        o.n = t; names.set(uid, o); cfg.names[uid] = o;
        const ks = Object.keys(cfg.names); if (ks.length > 600) ks.slice(0, ks.length - 600).forEach(k => { delete cfg.names[k]; names.delete(k); });
        clearTimeout(svT); svT = setTimeout(save, 3000);
    }
    function nameOfRow(img) {
        let row = img.parentElement, best = null;
        for (let i = 0; row && i < 7; i++, row = row.parentElement) {
            if ([...row.querySelectorAll(AV_SEL)].some(a => a !== img)) break;
            best = row;
            if (row.matches('[data-list-item-id], [role="listitem"], [role="treeitem"], li')) break;
        }
        if (!best) return null;
        const bad = x => { for (let y = x; y && y !== best; y = y.parentElement) if (y.matches(NMBAD)) return true; return false; };
        const w = document.createTreeWalker(best, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
            if (!(img.compareDocumentPosition(n) & 4) || img.contains(n)) continue;
            const t = n.nodeValue.trim(), e = n.parentElement;
            if (!t || t.length > 64 || !e || e.closest('.nyx-ics') || bad(e)) continue;
            let x = e, up = 0;
            while (x.parentElement && x.parentElement !== best && up++ < 2 && !x.parentElement.contains(img)
                && !x.parentElement.querySelector('img,svg,canvas') && x.parentElement.textContent.trim() === t) x = x.parentElement;
            return x;
        }
        return null;
    }
    function markNames(root) {
        const learn = !cfg.vanilla && cfg.sp.on && (cfg.sp.pdn || cfg.sp.pun), mark = nmOn(), sty = !cfg.vanilla && profiles.size > 0;
        if (!(mark || learn || sty) || !root.querySelectorAll) return;
        const imgs = [...root.querySelectorAll(AV_SEL)];
        if (root.matches && root.matches(AV_SEL)) imgs.push(root);
        for (const img of imgs) {
            if (img.closest(LI + ',' + PROF + ',[role="dialog"],#nyx-gui,#nyx-editor,.nyx-ics')) continue;
            const uid = avUid(img), p = uid && profiles.get(uid), sk = uid + '|' + (p ? (p.f || '') + (p.u || '') + (p.u2 || '') + (p.ul ? 'l' + p.us : '') + (p.uw || '') + p.uwn + (p.hs ? 'h' : '') : '');
            if (!cfg.vanilla) setHs(img, !!(p && p.hs)); // runs every pass so a dot that re-renders gets hidden again
            const prev = nmDone.get(img);
            if (prev && prev.isConnected && prev.dataset.nyxSk === sk && (mark ? prev.hasAttribute('data-nyx-sp') : !learn)) continue;
            const e = nameOfRow(img);
            if (!e) continue;
            nmDone.set(img, e);
            e.dataset.nyxSk = sk;
            if (mark) spSet(e, 'nm');
            if (sty || e.dataset.nyxFt || e.hasAttribute('data-nyx-uc') || e.hasAttribute('data-nyx-ug') || e.hasAttribute('data-nyx-gw')) userStyle(e, uid);
            if (sty) log('list name', uid, !!p, e.outerHTML.slice(0, 400));
            const t = e.textContent.trim();
            if (uid && learn && t) learnName(uid, t);
        }
    }

    // ─── Custom names in reply previews + DM list / header ("tab") ───────────
    function uidByName(t) {
        const k = norm((t || '').replace(/^@/, ''));
        if (!k) return null;
        for (const [id, n] of names) if ([n.g, n.n, n.u].some(v => v && norm(v) === k)) return id;
        return null;
    }
    function replyStyle(li) {
        li.querySelectorAll('[class*="repliedMessage"]').forEach(r => {
            let un = [...r.querySelectorAll('[class*="username" i]')].find(x => !x.closest('.nyx-ics'));
            if (!un) return;
            while (un.parentElement && un.parentElement !== r && /username/i.test(un.parentElement.getAttribute('class') || '')) un = un.parentElement;
            const av = r.querySelector(AV_SEL), uid = (av && avUid(av)) || uidByName(un.textContent);
            if (!uid) log('reply: no uid for', un.textContent);
            userStyle(un, uid);
        });
    }
    const TAB_SEL = '[data-list-item-id^="private-channels"], [class*="privateChannels" i], [class*="titleWrapper" i], section[class*="title" i], [class*="channelHeader" i]';
    function tabNames() {
        if (cfg.vanilla || !profiles.size) return;
        document.querySelectorAll(TAB_SEL).forEach(c => {
            if (c.closest('#nyx-gui,#nyx-editor')) return;
            c.querySelectorAll('span,div,h1,h2,h3').forEach(x => {
                if (x.querySelector('div,span,img,svg,h1,h2,h3') || x.closest('.nyx-ics,' + LI)) return;
                const t = x.textContent.trim();
                if (!t || t.length > 64) return;
                const uid = uidByName(t);
                if (uid) userStyle(x, uid);
            });
        });
    }

    function findNameEls(card, uid) {
        const nm = names.get(uid);
        if (!nm) return nameGuess(card);
        const dn = [nm.g, nm.n].filter(Boolean).map(norm), un = nm.u ? norm(nm.u) : '';
        if (!dn.length && un) dn.push(un);
        const word = ch => /[\p{L}\p{N}_]/u.test(ch || '');
        const hit = (k, n) => {
            if (!n) return false;
            if (k === n || k.replace(/^@/, '') === n) return true;
            if (n.length < 3 || k.length > n.length + 200) return false;
            const i = k.indexOf(n);
            return i >= 0 && !word(k[i - 1]) && !word(k[i + n.length]);
        };
        const r = { dn: [], un: [] }, done = new Set(), w = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        let n, c = 0;
        while ((n = w.nextNode()) && c++ < 700) {
            const pe = n.parentElement;
            if (!pe || pe === card || done.has(pe) || pe.closest('.nyx-ics') || pe.textContent.length > 260) continue;
            const k = norm(pe.textContent);
            if (!k) continue;
            const isUn = hit(k, un), isDn = dn.some(d => hit(k, d));
            if (isUn || isDn) { done.add(pe); if (isUn) r.un.push(pe); if (isDn) r.dn.push(pe); }
        }
        return (r.dn.length || r.un.length) ? r : nameGuess(card);
    }
    function nameGuess(card) {
        const cr = card.getBoundingClientRect(), c = [];
        card.querySelectorAll('[class*="name" i], [class*="tag" i], [class*="title" i], [class*="nick" i]').forEach(x => {
            const cl = x.getAttribute('class') || '', t = (x.textContent || '').trim(), r = x.getBoundingClientRect();
            if (!t || t.length > 40 || x.children.length > 2 || /banner|status|badge|pronoun|activity|role|server|guild|button|mutual|note|tab/i.test(cl)) return;
            if (r.top > cr.top + cr.height * .5 || x.querySelector('[class*="name" i], [class*="title" i]')) return;
            c.push({ x, t, fs: parseFloat(getComputedStyle(x).fontSize) || 0 });
        });
        if (!c.length) return null;
        c.sort((a, b) => b.fs - a.fs);
        const second = c.find(o => o.t.toLowerCase() !== c[0].t.toLowerCase());
        return { dn: [c[0].x], un: [second ? second.x : c[0].x] };
    }
    function findBioEls(card) {
        const cr = card.getBoundingClientRect(), out = [];
        card.querySelectorAll('[class*="bio" i], [class*="aboutMe" i]').forEach(x => {
            const r = x.getBoundingClientRect();
            if (x === card || x.closest('.nyx-ics') || r.height < 8 || r.height > cr.height * .75 || x.querySelector('img[src*="/avatars/"], [class*="banner" i]')) return;
            if (!x.textContent.trim() || x.querySelector('textarea, input, [contenteditable], [role="textbox"], [data-slate-editor]') || x.closest('[class*="note" i], [role="textbox"], [contenteditable]')) return;
            if (!out.some(o => o.contains(x))) out.push(x);
        });
        return out;
    }

    function paintBubble(card, p) {
        const BSEL = '[class*="bubble" i],[class*="thought" i]', rr = card.getBoundingClientRect();
        // search the whole profile root, plus bubbles floating outside it (portals) that overlap it
        const near = b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.right > rr.left && r.left < rr.right && r.bottom > rr.top && r.top < rr.bottom; };
        const all = [...document.querySelectorAll(BSEL)].filter(b => !b.closest('.nyx-cv,#nyx-gui,#nyx-editor') && (card.contains(b) || (near(b) && !b.closest(LI + ',[class*="member" i],[data-list-item-id],[class*="sidebar" i]'))));
        all.forEach(b => { b.toggleAttribute('data-nyx-sbt', !!p.sx); if (p.sx) { bak(b); b.style.setProperty('--nyx-sx', p.sx); } });
        // wipe the previous body paint, then repaint (synchronous, so no flicker)
        document.querySelectorAll('[data-nyx-sbd]').forEach(x => {
            ['background-color', 'background-image', 'fill'].forEach(k => x.style.removeProperty(k));
            x.removeAttribute('data-nyx-sbd'); x.removeAttribute('data-nyx-sbp');
        });
        if (!p.sb) return;
        if (!all.length) {
            log('bubble: nothing matched. bubble-ish classes in doc:', document.querySelectorAll(BSEL).length,
                '| status-ish classes in profile root:', [...new Set([...card.querySelectorAll('[class]')].map(e => String(e.getAttribute('class'))).filter(k => /status|custom|thought|prompt|emoji|speech|tail|dot/i.test(k)))].slice(0, 25));
            return;
        }
        const cr = card.getBoundingClientRect(), area = e => { const r = e.getBoundingClientRect(); return r.width * r.height; };
        // the bubble body and its tail dots often live in different elements: take the bubble element plus up to 2 small parents
        const tops = all.filter(b => !all.some(o => o !== b && o.contains(b))), units = new Set();
        tops.forEach(t => {
            let u = t;
            for (let i = 0; i < 2 && u.parentElement && u.parentElement !== card; i++) {
                const q = u.parentElement;
                if (area(q) > cr.width * cr.height * .35 || q.querySelector('h1,h2,h3')) break;
                u = q;
            }
            units.add(u);
        });
        const cand = [], pseu = [];
        units.forEach(u => [u, ...u.querySelectorAll('*')].forEach(x => {
            if (x.closest('.nyx-cv,#nyx-gui,#nyx-editor') || /^(IMG|VIDEO|CANVAS|IMAGE|FOREIGNOBJECT)$/i.test(x.tagName) || cand.includes(x)) return;
            if (x instanceof SVGElement) {
                const sv = x.ownerSVGElement;
                if (!sv || !/^(path|circle|ellipse|rect|polygon)$/i.test(x.tagName) || x.closest('mask,defs,clipPath,pattern')) return;
                if (sv.querySelector('foreignObject,image') || sv.getBoundingClientRect().width < 28) return;
                const f = getComputedStyle(x).fill; if (f && f !== 'none') cand.push(x);
                return;
            }
            if (x.querySelector(AV_SEL) || x.querySelector('[class*="banner" i]') || /avatar|banner|decoration/i.test(x.getAttribute('class') || '')) return;
            const cs = getComputedStyle(x);
            if (alphaOf(cs.backgroundColor) > .01 || /gradient|url\(/.test(cs.backgroundImage)) cand.push(x);
            if (['::before', '::after'].some(ps => alphaOf(getComputedStyle(x, ps).backgroundColor) > .01)) pseu.push(x);
        }));
        // skip small things nested in a bigger painted element (the + circle inside the bubble), keep body + tail dots
        const keep = cand.filter(c => !cand.some(o => o !== c && o.contains(c) && area(c) < area(o) * .5));
        keep.forEach(x => {
            bak(x); x.setAttribute('data-nyx-sbd', ''); x.style.setProperty('--nyx-sb', p.sb);
            if (x instanceof SVGElement) x.style.setProperty('fill', p.sb, 'important');
            else { x.style.setProperty('background-image', 'none', 'important'); x.style.setProperty('background-color', p.sb, 'important'); }
        });
        pseu.forEach(x => { bak(x); x.setAttribute('data-nyx-sbd', ''); x.setAttribute('data-nyx-sbp', ''); x.style.setProperty('--nyx-sb', p.sb); });
        log('bubble:', 'matches', all.length, 'units', units.size, 'painted', keep.length, 'pseudo', pseu.length, all.slice(0, 4).map(b => b.className), [...units].map(u => u.outerHTML.slice(0, 900)));
    }

    function themeRoot(c, van) {
        let uid = null, av = null, area = 0;
        c.querySelectorAll(AV_SEL).forEach(i => {
            const u = avUid(i); if (!u) return;
            const r = i.getBoundingClientRect(), a = r.width * r.height;
            if (a > area) { uid = u; av = i; area = a; }
        });
        const card = av ? pickCard(c, av) : c;
        if (card.dataset.nyxOwner !== (uid || '')) { unthemeCard(card); card.dataset.nyxOwner = uid || ''; }
        if (!uid) return;
        const p = profiles.get(uid), ne = findNameEls(card, uid), S = van ? {} : cfg.sp;
        if (av) setHs(av, !van && !!(p && p.hs)); // hide the online dot on the big avatar if they set s=0
        if (S.on && S.pbio) findBioEls(card).forEach(x => spSet(x, 'pb'));
        if (ne && S.on) { if (S.pdn) ne.dn.forEach(x => spSet(x, 'pn')); if (S.pun) ne.un.forEach(x => spSet(x, 'pu')); }
        if (ne) [...ne.dn, ...ne.un].forEach(x => userStyle(x, uid, true)); // their shared font + name color
        const ics = !van && p && p.ic && p.ic.length ? p.ic : null, key = ics ? uid + '|' + ics.join(',') : '';
        let old = card.querySelector('.nyx-ics');
        if (old && old.dataset.k !== key) { old.remove(); old = null; }
        if (ics && !old && ne) { const t = ne.dn[0] || ne.un[0]; if (t) t.after(makeIcons(ics, key)); }
        if (van || !p) return;
        paintBubble(c, p);
        const bn = findBanner(card);
        log('theming', 'uid:', uid, '| card:', card.className, '| banner:', bn && bn.className);
        if (p.c) paintCard(card, p, bn);
        if (p.t) { bak(card); card.style.setProperty('--nyx-tc', p.t); card.dataset.nyxTc = '1'; }
        else if (card.dataset.nyxTc) { card.style.removeProperty('--nyx-tc'); delete card.dataset.nyxTc; }
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
        const pf = pfpOn();
        if (!pf) document.querySelectorAll('img[data-nyx-pf]').forEach(avaRestore);
        document.querySelectorAll(AV_SEL).forEach(i => { if (pf) pfpReplace(i); else if (!cfg.vanilla) avaReplace(i); if (!cfg.vanilla) trackImg(i); });
        if (!pf) document.querySelectorAll('img[data-nyx-oa]').forEach(i => { const u = avUid(i), p = u && profiles.get(u); if (cfg.vanilla || !p || !p.a) avaRestore(i); });
        if (!cfg.vanilla) document.querySelectorAll(LI).forEach(iconsFor);
        markNames(document); markTags(document); tabNames();
        profileRoots().forEach(c => themeRoot(c, cfg.vanilla));
    }

    function genPayload(vis) {
        const p = cfg.prof, ref = r => normRef(r), n3 = t => t.map(v => Math.round(v)).join(',');
        const parts = ['nyx'];
        if (p.c) parts.push('c=' + p.c1.slice(1) + ',' + p.c2.slice(1));
        if (p.tx) parts.push('t=' + p.txc.slice(1));
        if (p.ux) parts.push('u=' + p.uxc.slice(1) + (p.ug ? ',' + p.uxc2.slice(1) : ''));
        if (p.ux && p.ug && p.ugl) parts.push('ul=1', 'us=' + (p.ugs || 4));
        if (p.cw) parts.push('uw=' + p.cwc.slice(1) + ',' + (p.cwn || 8));
        if (p.px) parts.push('v=' + p.pxc.slice(1) + (p.pg ? ',' + p.pxc2.slice(1) : ''));
        if (p.px && p.pg && p.pgl) parts.push('vl=1', 'vs=' + (p.pgs || 4));
        if (p.vw) parts.push('vw=' + p.vwc.slice(1) + ',' + (p.vwn || 8));
        if (p.hs) parts.push('s=0');
        if (p.sb) parts.push('sb=' + p.sbc.slice(1));
        if (p.sx) parts.push('sx=' + p.sxc.slice(1));
        const fn = fontName(); if (fn) parts.push('f=' + fn.replace(/ /g, '+'));
        const ic = (p.ic || []).map(v => (v || '').trim()).filter(Boolean).slice(0, 3)
            .map(v => /^(https?:\/\/|i\.imgur\.com\/|files\.catbox\.moe\/)/.test(v) ? normRef(v) : 'x:' + [...v].slice(0, 8).map(ch => ch.codePointAt(0).toString(16)).join('-'));
        if (ic.length) parts.push('ic=' + ic.join(','));
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
        const sec = (title, hint) => el('details', {}, el('summary', { textContent: title }), el('div', { className: 'nyx-hint', textContent: hint }));
        const zoomRow = (t, min, max, onChange) => {
            const r = el('input', { type: 'range', min, max, value: t[2] });
            r.oninput = () => { t[2] = +r.value; save(); onChange(); };
            return { row: el('label', {}, 'zoom', r), sync: () => { r.value = t[2]; } };
        };

        const coverSection = (title, key, rawRef, w, h, round) => {
            const t = P[key], def = key === 'bp' ? BP : AP, ref = (rawRef || '').trim() ? normRef(rawRef) : '';
            const s = sec(title, ref ? 'drag to move · scroll to zoom' : 'set the url in the main panel first');
            if (!ref) return s;
            const f = el('div', { className: 'nyx-frame' });
            Object.assign(f.style, { width: w + 'px', height: h + 'px', borderRadius: round ? '50%' : '0' });
            s.append(f);
            ed.append(s);
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

    // ─── Name style gui: live previews, font picker, gradient / flow / glow ──────────────
    const NK = { c: { on: 'ux', c1: 'uxc', g: 'ug', c2: 'uxc2', l: 'ugl', s: 'ugs', w: 'cw', wc: 'cwc', wn: 'cwn' }, p: { on: 'px', c1: 'pxc', g: 'pg', c2: 'pxc2', l: 'pgl', s: 'pgs', w: 'vw', wc: 'vwc', wn: 'vwn' } };
    const pvs = [];
    const reg = f => { pvs.push(f); try { f(); } catch (e) {} };
    const refreshPv = () => pvs.forEach(f => { try { f(); } catch (e) {} });
    const nameSpec = chat => {
        const P = cfg.prof, k = chat ? NK.c : NK.p, on = P[k.on], gr = on && P[k.g];
        return { f: fontName(), c: on ? P[k.c1] : null, c2: gr ? P[k.c2] : null, l: gr && P[k.l], sp: P[k.s], g: P[k.w] ? P[k.wc] : null, gn: P[k.wn] };
    };
    function mkPreview(title, chat) {
        const n = el('span', { textContent: 'Your Name' }), t = el('div', { textContent: chat ? 'hey, this is how your name looks in chat' : 'about me: this is your profile card' });
        t.style.cssText = 'font-size:13px;margin-top:2px';
        const box = el('div', { className: 'nyx-pv' }, el('small', { textContent: title }), n, t);
        reg(() => {
            const P = cfg.prof;
            box.style.background = chat ? '#313338' : (P.c ? `linear-gradient(${P.c1},${P.c2})` : '#232428');
            t.style.color = chat ? '#dbdee1' : (P.tx ? P.txc : '#dbdee1');
            nameStyle(n, nameSpec(chat));
        });
        return box;
    }
    function nameUI(fc, FONTS) {
        pvs.length = 0;
        const P = cfg.prof, rows = [], note = t => el('div', { textContent: t, style: 'color:#888;margin-top:4px' });
        const wrap = el('div', { className: 'nyx-pvw' }, mkPreview('preview: your name in chat', true), mkPreview('preview: your name on your profile card', false));

        // font picker: every row is written in its own font
        const fl = el('div', { className: 'nyx-fl' }), frows = [], fam = v => v.startsWith('g:') ? famOf(v.slice(2)) : v;
        FONTS.forEach(([v, t]) => {
            const r = el('div', { className: 'nyx-fr', textContent: t });
            if (v) r.style.fontFamily = fam(v);
            r.onclick = () => { cfg.ufont = v; cfg.ufontc = ''; fc.value = ''; save(); apply(); refreshPv(); };
            frows.push([r, v]); fl.append(r);
        });
        reg(() => frows.forEach(([r, v]) => r.toggleAttribute('data-on', !cfg.ufontc && cfg.ufont === v)));
        let fonts = false;
        const lazy = () => { if (fonts) return; fonts = true; FONTS.forEach(([v]) => { if (v.startsWith('g:')) loadWebFont(v.slice(2)); }); };
        fl.addEventListener('mouseenter', lazy);
        if (typeof IntersectionObserver === 'function') new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) lazy(); }).observe(fl);
        fc.addEventListener('input', () => { cfg.ufontc = fc.value; refreshPv(); });

        // option rows that only show when the option above them is on
        const mk = (label, key, type, dep, o = {}) => {
            const i = el('input', { type });
            if (type === 'range') { i.min = o.min; i.max = o.max; i.step = o.step || 1; }
            if (type === 'checkbox') i.checked = !!P[key]; else i.value = P[key];
            const val = o.fmt ? el('span', { textContent: o.fmt(P[key]), style: 'width:38px;text-align:right;color:#888' }) : null;
            i.oninput = i.onchange = () => { P[key] = type === 'checkbox' ? i.checked : type === 'range' ? +i.value : i.value; if (val) val.textContent = o.fmt(P[key]); save(); refreshPv(); };
            const lab = el('label', {}, label, val ? el('span', {}, i, val) : i);
            rows.push([lab, dep]);
            return lab;
        };
        const group = (title, k) => {
            const on = () => P[k.on], gr = () => P[k.on] && P[k.g], lp = () => gr() && P[k.l], gl = () => P[k.w];
            return [el('h4', { textContent: title }),
                mk('custom name color', k.on, 'checkbox', () => true),
                mk('color', k.c1, 'color', on),
                mk('make it a gradient', k.g, 'checkbox', on),
                mk('gradient end color', k.c2, 'color', gr),
                mk('flowing animation', k.l, 'checkbox', gr),
                mk('flow speed', k.s, 'range', lp, { min: 1, max: 10, fmt: v => v + '/10' }),
                mk('glow', k.w, 'checkbox', () => true),
                mk('glow color', k.wc, 'color', gl),
                mk('glow size', k.wn, 'range', gl, { min: 2, max: 20, fmt: v => v + 'px' })];
        };
        const chatG = group('name in chat + member list', NK.c), cardG = group('name on your profile card', NK.p);
        reg(() => rows.forEach(([l, d]) => { l.style.display = d() ? '' : 'none'; }));
        return [wrap, el('h4', { textContent: 'font (click one)' }), fl, el('label', {}, 'or type any font', fc), note('google fonts and fonts installed on your pc both work'), ...chatG, ...cardG];
    }

    let gui = null;
    function buildGui() {
        const g = el('div', { id: 'nyx-gui', style: 'display:block' });
        g.toggleAttribute('data-van', !!cfg.vanilla);
        g.addEventListener('keydown', e => e.stopPropagation());
        const chk = (t, id, get, set) => {
            const i = el('input', { type: 'checkbox', checked: get() });
            if (id) i.id = id;
            i.onchange = () => { set(i.checked); save(); apply(); };
            return el('label', {}, t, i);
        };
        const sec = (title, cls, ...kids) => g.append(el('details', { className: cls }, el('summary', { textContent: title }), ...kids));
        const hint = t => el('div', { textContent: t, style: 'color:#888;margin-top:4px' });
        const upBtn = (accept, cb) => el('button', { textContent: '↑', title: 'upload from pc', onclick: () => pickFile(accept, cb) });

        g.append(el('div', { textContent: 'opsec 1 million script' }),
            el('button', { id: 'nyx-en', textContent: enabled ? 'on' : 'off', onclick: () => setEnabled(!enabled) }),
            chk('vanilla mode', 'nyx-van', () => cfg.vanilla, setVanilla));

        sec('general', '',
            chk('hide normal msgs + files', '', () => cfg.hide, v => { cfg.hide = v; if (enabled) scanAll(); }),
            chk('minimize instead of hide', '', () => cfg.min, v => { cfg.min = v; }),
            chk('strip metadata on upload', '', () => cfg.strip, v => { cfg.strip = v; }),
            chk('block typing indicator', '', () => cfg.notype, v => { cfg.notype = v; }),
            chk('start enabled on load', '', () => cfg.auto, v => { cfg.auto = v; }),
            chk('debug logging', '', () => cfg.debug, v => { cfg.debug = v; }),
            el('button', { textContent: 'reset', onclick: () => {
                cfg = { ...JSON.parse(JSON.stringify(D)), lib: cfg.lib, prof: cfg.prof, known: cfg.known };
                save(); setVanilla(true); gui.remove(); gui = null; toggleGui();
            } }));

        const ln = el('input', { type: 'text', placeholder: 'name' }), lu = el('input', { type: 'text', placeholder: 'emoji/sticker url or id' });
        libBox = el('div');
        sec('emojis', '', el('label', {}, ln), el('label', {}, lu), el('button', { textContent: 'add', onclick: async () => {
            let v = lu.value.trim();
            if (isTenorPage(v)) {
                try { v = await tenorDirect(v); } catch (e) { alert('could not read that tenor page. right click the gif > copy image address, and paste that (media.tenor.com/...gif)'); return; }
            }
            const a = parseAsset(v, ln.value.trim());
            if (a) { addLib(a, ln.value.trim() || a.n); ln.value = lu.value = ''; }
        } }), el('button', { textContent: 'upload emoji from pc', onclick: () => pickFile('image/*', (u, f) => {
            let nm = (ln.value.trim() || f.name.replace(/\.\w+$/, '')).replace(/\W/g, '').slice(0, 32);
            if (nm.length < 2) nm = 'emoji' + (cfg.lib.length + 1);
            const a = parseAsset(u, nm);
            if (a) { addLib(a, nm); ln.value = ''; }
        }) }), libBox, hint('use :name: in msgs. alt+click any emoji or sticker in chat to save it'));
        renderLib();

        const cc = el('div');
        for (const [k, t] of [['enc', 'encrypted text'], ['plain', 'normal text'], ['file', 'files (border)']]) {
            cc.append(el('h4', { textContent: t }));
            for (const [f, n, ty] of [['fg', 'color', 'color'], ['bg', 'background', 'color'], ['ba', 'bg opacity', 'range'], ['op', 'opacity', 'range']]) {
                const i = el('input', { type: ty, value: cfg[k][f] });
                i.oninput = () => { cfg[k][f] = ty === 'range' ? +i.value : i.value; save(); apply(); };
                cc.append(el('label', {}, n, i));
            }
        }
        cc.append(chk('no border on files', '', () => cfg.fnb, v => { cfg.fnb = v; }));
        sec('message colors', 'nyx-nv', cc);


        const FONTS = [['', 'default'], ['monospace', 'monospace'], ['serif', 'serif'], ['sans-serif', 'sans-serif'], ['cursive', 'cursive'], ['fantasy', 'fantasy'],
            ['"Comic Sans MS",cursive', 'comic sans (system)'], ['"Courier New",monospace', 'courier (system)'], ['Impact,sans-serif', 'impact (system)'], ['Georgia,serif', 'georgia (system)'], ['"Times New Roman",serif', 'times (system)'],
            ...['Pacifico', 'Lobster', 'Press Start 2P', 'VT323', 'Bangers', 'Creepster', 'Orbitron', 'Permanent Marker', 'Dancing Script', 'Special Elite', 'Cinzel', 'Fira Code', 'Caveat', 'Righteous', 'Monoton', 'Audiowide', 'Rubik Glitch', 'Nosifer', 'Chewy', 'Black Ops One', 'Gloria Hallelujah', 'Unifraktur Cook'].map(n => ['g:' + n, n])];


        const fc = el('input', { type: 'text', placeholder: 'any google/installed font', value: cfg.ufontc });
        fc.onchange = () => { cfg.ufontc = fc.value; save(); apply(); };
        sec('name style (font, gradient, glow)', 'nyx-nv', ...nameUI(fc, FONTS),
            chk('hide server tags', '', () => cfg.stag, v => { cfg.stag = v; if (enabled) markTags(document); }),
            hint('everything in this section lives in your bio: after changing it open "profile card", hit "generate + copy" and paste it into your about me. only people running the script see it.'));

        const sp = (t, k) => chk(t, '', () => cfg.sp[k], v => { cfg.sp[k] = v; applySp(); });
        sec('spoiler mode', 'nyx-nv', sp('spoiler mode on', 'on'), sp('reveal on hover', 'hov'), sp('attachments', 'att'), sp('emojis', 'emo'),
            sp('usernames (chat, lists, panel)', 'nm'), sp('profile display name', 'pdn'), sp('profile username', 'pun'), sp('profile bio', 'pbio'));

        const ps = el('select');
        [['off', 'normal'], ['black', 'all black'], ['color', 'color per user'], ['number', 'number per user']].forEach(([v, t]) => ps.append(el('option', { value: v, textContent: t })));
        ps.value = cfg.pfp;
        ps.onchange = () => { cfg.pfp = ps.value; save(); apply(); if (enabled) { applyProfiles(); scanAll(); } };
        sec('profile pictures', 'nyx-nv', el('label', {}, 'hide pictures', ps));

        const pf = [];
        const pfield = (n, ty, k, up) => { // up = add an "upload from pc" button (catbox)
            const i = el('input', { type: ty });
            if (ty === 'checkbox') i.checked = cfg.prof[k]; else i.value = cfg.prof[k];
            i.oninput = i.onchange = () => { cfg.prof[k] = ty === 'checkbox' ? i.checked : i.value; save(); refreshPv(); };
            if (!up) { pf.push(el('label', {}, n, i)); return; }
            i.style.width = '76px';
            pf.push(el('label', {}, n, el('span', {}, i, upBtn('image/*', u => { i.value = cfg.prof[k] = u; save(); }))));
        };
        pf.push(mkPreview('preview: your profile card', false), el('h4', { textContent: 'card colors' }));
        pfield('color the card', 'checkbox', 'c'); pfield('top color', 'color', 'c1'); pfield('bottom color', 'color', 'c2');
        pfield('tint card text', 'checkbox', 'tx'); pfield('card text color', 'color', 'txc');
        pfield('color status bubble', 'checkbox', 'sb'); pfield('bubble color', 'color', 'sbc'); pfield('bubble text color on', 'checkbox', 'sx'); pfield('bubble text color', 'color', 'sxc');


        pf.push(el('h4', { textContent: 'privacy' })); pfield('hide my online dot', 'checkbox', 'hs'); pf.push(el('h4', { textContent: 'icons next to your name (url or emoji)' }));
        for (let i = 0; i < 3; i++) {
            const ii = el('input', { type: 'text', placeholder: 'url or emoji', value: cfg.prof.ic[i] || '', style: 'width:76px' });
            ii.oninput = () => { cfg.prof.ic[i] = ii.value; save(); };
            pf.push(el('label', {}, 'icon ' + (i + 1), el('span', {}, ii, upBtn('image/*', u => { ii.value = cfg.prof.ic[i] = u; save(); }))));
        }
        pf.push(el('h4', { textContent: 'images (the arrow uploads from your pc)' })); pfield('banner url', 'text', 'b', 1); pfield('decoration url', 'text', 'd', 1); pfield('avatar url (gif/png)', 'text', 'a', 1);
        const info = el('div', { style: 'color:#888;margin-top:4px;word-break:break-all' });
        const sizeNote = t => { const cp = [...t].length; return `${cp}/190 chars` + (t.length !== cp ? ` (${t.length} utf-16)` : ''); };
        sec('profile card (goes in your bio)', 'nyx-nv', ...pf,
            chk('short bio (stored on catbox)', '', () => cfg.ptr, v => { cfg.ptr = v; }),
            el('button', { textContent: 'position editor (drag to place)', onclick: openEditor }),
            el('button', { textContent: 'generate + copy', onclick: async () => {
                info.textContent = 'working...';
                try {
                    const r = await makeBio();
                    try { await navigator.clipboard.writeText(r.t); } catch (e) { prompt('copy this into your about me:', r.t); }
                    info.textContent = `copied (${sizeNote(r.t)}${r.p ? ', short pointer' : ''}). paste it at the end of your about me` + (r.w ? ' - ' + r.w : '');
                } catch (e) { info.textContent = 'failed: ' + (e.message || e); }
            } }),
            el('button', { textContent: 'copy visible version (test)', onclick: async () => {
                await resolveTenorProf();
                const t = genPayload(true);
                navigator.clipboard.writeText(t).then(() => { info.textContent = 'copied visible text: ' + t; }, () => { info.textContent = 'copy failed'; });
            } }),
            info, hint('↑ uploads a file from your pc to basepic.com (public link, metadata stripped if enabled). debug: alt+d with a profile open copies its dom layout'));
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
    document.addEventListener('DOMContentLoaded', () => { mount(); if (enabled) { scanAll(); profiles.forEach(prefetch); schedule(); } });
    setInterval(() => { mount(); if (enabled) schedule(); }, 1500);

    let rs = false;
    window.addEventListener('keydown', e => {
        if (e.code === 'ShiftRight') { if (!e.repeat) rs = true; } else rs = false;
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') { e.preventDefault(); setEnabled(!enabled); }
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyV') { e.preventDefault(); setVanilla(!cfg.vanilla); }
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyD') {
            e.preventDefault();
            const t = domDump(); console.log('[opsec] dom dump\n' + t);
            try { navigator.clipboard.writeText(t); } catch (x) {}
        }
    }, true);
    window.addEventListener('keyup', e => {
        if (e.code === 'ShiftRight' && rs) { rs = false; toggleGui(); }
    }, true);

    console.log('[opsec 1 million script v19.5.0] loaded. enabled =', enabled);
})();
