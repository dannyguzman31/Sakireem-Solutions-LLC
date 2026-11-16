import {lookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import ipaddr from 'ipaddr.js';
import {parse} from 'parse5';

const DASHBOARD = 'https://sensational-cucurucho-b41b69.netlify.app';
const MAX_BYTES = 1_000_000;
const MAX_TEXT = 60_000;
const skipped = new Set(['script','style','noscript','template','svg','iframe','nav','footer','form']);
const blocks = new Set(['p','div','section','article','li','tr','td','br','h1','h2','h3','h4','h5','h6']);

export const config = {
  path:'/api/knowledge-web',
  rateLimit:{windowLimit:12,windowSize:60,aggregateBy:['ip','domain']}
};

export function pageText(html) {
  const doc = parse(html);
  let title = '';
  function collect(node) {
    if (skipped.has(node.nodeName) || node.attrs?.some(a=>a.name==='hidden' || (a.name==='aria-hidden' && a.value==='true'))) return '';
    if (node.nodeName === '#text') return node.value.replace(/\s+/g,' ');
    const text = (node.childNodes || []).map(collect).join('');
    if (node.nodeName === 'title') {title = text.trim();return '';}
    return blocks.has(node.nodeName) ? '\n'+text+'\n' : text;
  }
  const text = collect(doc).split('\n').map(s=>s.trim()).filter(Boolean).join('\n');
  return {title:title.slice(0,160),text};
}

export function parsePageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || ipaddr.isValid(url.hostname.replace(/^\[|\]$/g,''))) {
    throw new Error('Enter a public HTTPS web page URL.');
  }
  url.hash = '';
  return url;
}

async function fetchPage(url, remaining, signal) {
  signal.throwIfAborted();
  const addresses = await lookup(url.hostname,{all:true,family:4});
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({address})=>ipaddr.parse(address).range()!=='unicast')) {
    throw new Error('This address is unavailable for import.');
  }
  const page = await new Promise((resolve,reject)=>{
    const req = httpsRequest({
      hostname:addresses[0].address, servername:url.hostname, path:url.pathname+url.search,
      headers:{Host:url.host,Accept:'text/html'}, agent:false, signal
    },res=>{
      const code = res.statusCode;
      if ([301,302,303,307,308].includes(code) && res.headers.location) {
        res.destroy();
        resolve({redirect:res.headers.location});
        return;
      }
      if (code!==200 || !/^text\/html(?:\s*;|$)/i.test(res.headers['content-type']||'')) {
        res.destroy();reject(new Error('The URL must return a readable HTML page.'));return;
      }
      let bytes=0;
      const chunks=[];
      res.on('data',chunk=>{
        bytes+=chunk.length;
        if (bytes>MAX_BYTES) {req.destroy(new Error('This page is too large to import.'));return;}
        chunks.push(chunk);
      });
      res.on('error',reject);
      res.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    req.end();
  });
  if (!page.redirect) return page.html;
  if (!remaining) throw new Error('This page redirects too many times.');
  return fetchPage(parsePageUrl(new URL(page.redirect,url).href),remaining-1,signal);
}

async function isAdmin(auth) {
  if (!auth?.startsWith('Bearer ')) return false;
  const key = process.env.SUPABASE_SECRET_KEY;
  const root = process.env.SUPABASE_URL;
  if (!key || !root) throw new Error('Supabase configuration is missing.');
  const headers = {apikey:key, Authorization:auth};
  const user = await fetch(new URL('/auth/v1/user',root),{headers,signal:AbortSignal.timeout(4000)});
  if (!user.ok) return false;
  const id = (await user.json()).id;
  if (!id) return false;
  const endpoint = new URL('/rest/v1/platform_admins',root);
  endpoint.searchParams.set('select','user_id');
  endpoint.searchParams.set('user_id','eq.'+id);
  const response = await fetch(endpoint,{headers,signal:AbortSignal.timeout(4000)});
  return response.ok && (await response.json()).some(row=>row.user_id===id);
}

export default async function knowledgeWeb(req) {
  const origin = req.headers.get('origin');
  if (origin !== DASHBOARD) return new Response(null,{status:403});
  const headers = {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'Authorization, Content-Type',
    'Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store',Vary:'Origin'};
  const reply = (status,body)=>Response.json(body,{status,headers});
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return reply(405,{error:'Use POST.'});
  try {
    if (!await isAdmin(req.headers.get('authorization'))) return reply(403,{error:'Sign in as an administrator to import a page.'});
    const {url} = await req.json();
    if (typeof url !== 'string' || url.length > 2048) return reply(400,{error:'Enter a public HTTPS web page URL.'});
    const target = parsePageUrl(url);
    const extracted = pageText(await fetchPage(target,3,AbortSignal.timeout(6000)));
    if (!extracted.text) return reply(422,{error:'No readable text found. Try pasting the page text.'});
    if (extracted.text.length > MAX_TEXT) return reply(422,{error:'This page has too much text. Paste a shorter section.'});
    return reply(200,extracted);
  } catch (error) {
    if (error.message==='Enter a public HTTPS web page URL.') return reply(400,{error:error.message});
    return reply(422,{error:'Could not import this page. Use a public HTTPS page or paste its text.'});
  }
}
