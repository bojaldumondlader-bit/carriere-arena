import fs from 'node:fs/promises';
import * as cheerio from 'cheerio';

const API = 'https://it.wikipedia.org/w/api.php';
const TARGET = Number(process.env.CAREER_TARGET || 4000);
const USER_AGENT = 'CarriereArena/1.0 (static-game database builder)';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function api(params) {
  const url = new URL(API);
  Object.entries({ ...params, format: 'json', formatversion: '2' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Wikipedia HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.info || 'Wikipedia API error');
  return data;
}

async function categoryPages(root, limit = 25000) {
  const queue = [root], seenCategories = new Set(), pages = new Set();
  while (queue.length && pages.size < limit) {
    const category = queue.shift();
    if (seenCategories.has(category)) continue;
    seenCategories.add(category);
    let cont = {};
    do {
      const data = await api({ action: 'query', list: 'categorymembers', cmtitle: category, cmtype: 'page|subcat', cmlimit: 'max', ...cont });
      for (const item of data.query?.categorymembers || []) {
        if (item.ns === 14 && /calciator|giocator|footballer|futbol/i.test(item.title)) queue.push(item.title);
        if (item.ns === 0) pages.add(item.title);
        if (pages.size >= limit) break;
      }
      cont = data.continue || null;
      await sleep(80);
    } while (cont && pages.size < limit);
    console.log(`Categorie: ${seenCategories.size} | candidati: ${pages.size}`);
  }
  return [...pages];
}

function numeric(value) {
  const match = String(value).replace(/\s/g, '').match(/\d+/);
  return match ? Number(match[0]) : null;
}

function extractCareer(html) {
  const $ = cheerio.load(html);
  const candidates = $('table').filter((_, table) => /squadre|club|carriera/i.test($(table).text()));
  for (const table of candidates.toArray()) {
    const rows = [];
    $(table).find('tr').each((_, tr) => {
      const cells = $(tr).find('th,td').map((__, cell) => $(cell).text().replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim()).get();
      if (cells.length < 4 || !/(18|19|20)\d{2}/.test(cells[0])) return;
      const numbers = cells.slice(2).map(numeric).filter(Number.isInteger);
      const club = cells[1]?.replace(/\s*\([^)]*\)/g, '').trim();
      if (club && numbers.length >= 2 && !/nazionale|totale/i.test(club)) {
        rows.push({ years: cells[0], club, appearances: numbers[0], goals: numbers[1] });
      }
    });
    if (rows.length >= 3) return rows;
  }
  return null;
}

async function parsePlayer(title) {
  const data = await api({ action: 'parse', page: title, prop: 'text' });
  const career = extractCareer(data.parse.text);
  if (!career) return null;
  const id = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { id, name: data.parse.title, career, wikipedia: `https://it.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}` };
}

const candidates = await categoryPages('Categoria:Calciatori');
const records = [], ids = new Set();
for (const [index, title] of candidates.entries()) {
  if (records.length >= TARGET) break;
  try {
    const record = await parsePlayer(title);
    if (record && !ids.has(record.id)) {
      ids.add(record.id);
      records.push(record);
      console.log(`[${records.length}/${TARGET}] ${record.name}`);
    }
  } catch (error) {
    console.warn(`Scartata ${title}: ${error.message}`);
  }
  if (index % 10 === 0) await sleep(250);
}

if (records.length < TARGET) console.warn(`Attenzione: trovati ${records.length}/${TARGET} profili validi.`);
const output = `/* Dati estratti da Wikipedia Italia. Fonte e link presenti per ogni profilo. */\nwindow.CAREERS = ${JSON.stringify(records)};\n`;
await fs.writeFile('database.js', output, 'utf8');
console.log(`Creato database.js con ${records.length} profili.`);
