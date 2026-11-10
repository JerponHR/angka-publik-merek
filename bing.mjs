// Bing Webmaster ke laporan harian merek (11 Nov 2026). Dijalankan GitHub Actions, bukan Cloudflare: Bing mencekik alamat
// keluar Cloudflare ("kode 17 ThrottleIP"). Alat ini memanggil tiga metode API Bing per situs lalu mengirim JAWABAN MENTAH
// ke worker laporan lewat pintu bertanda tangan (POST /masuk/bing, HMAC-SHA256). Perangkumannya dilakukan worker.
// Repo ini publik, begitu juga log Actions: alat ini TIDAK PERNAH mencetak kunci, angka, kata kunci, atau badan jawaban.
// Yang dicetak hanya status HTTP, jumlah baris, dan NAMA medan JSON. Tidak ada berkas data yang ditulis ke repo.
// Rahasia (Settings, Secrets and variables, Actions): BING_WEBMASTER_KEY, LAPORAN_MASUK_SECRET.
import {createHmac} from 'node:crypto';

const API = 'https://ssl.bing.com/webmaster/api.svc/json';
const TUJUAN = process.env.LAPORAN_URL || 'https://rico-brand-reports.evora-rico.workers.dev';
const SITUS = {jerpon: 'https://jerukpontianak.com/', firstclass: 'https://firstclasstattoostudio.com/', pokebawl: 'https://pokebawltcg.com/', evora: 'https://evoracircle.com/'};
const KUNCI = process.env.BING_WEBMASTER_KEY || '', RAHASIA = process.env.LAPORAN_MASUK_SECRET || '';
const MAKS_KUERI = 400;
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const bentuk = (j) => { const d = j?.d; if (Array.isArray(d)) return `d:Array(${d.length})${d[0] ? ` medan[${Object.keys(d[0]).sort().join(',')}]` : ''}`; if (d && typeof d === 'object') return `d:Object medan[${Object.keys(d).sort().join(',')}]${Array.isArray(d.Links) ? ` Links(${d.Links.length})${d.Links[0] ? ` medan[${Object.keys(d.Links[0]).sort().join(',')}]` : ''}` : ''}`; return `medan[${Object.keys(j ?? {}).sort().join(',')}]`; };

async function panggil(metode, situs, lain = '') {
  try {
    const r = await fetch(`${API}/${metode}?siteUrl=${encodeURIComponent(situs)}${lain}&apikey=${encodeURIComponent(KUNCI)}`, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(20000)});
    const teks = await r.text();
    let j = null; try { j = JSON.parse(teks); } catch { j = null; }
    if (r.status === 200 && j && j.ErrorCode === undefined) return {j, catat: `HTTP 200 ${bentuk(j)}`};
    const pesan = String(j?.Message ?? '').split(KUNCI).join('[kunci]').slice(0, 120);
    return {gagal: {http: r.status, kode: Number.isInteger(j?.ErrorCode) ? j.ErrorCode : null, pesan}, catat: `HTTP ${r.status}${Number.isInteger(j?.ErrorCode) ? ` kode ${j.ErrorCode}` : ''} ${pesan.replace(/[^\w !]/g, '')}`};
  } catch (error) { return {gagal: {http: null, kode: null, pesan: error?.name === 'TimeoutError' ? 'batas waktu' : 'jaringan'}, catat: `tidak terjangkau (${error?.name ?? 'galat'})`}; }
}

async function kirim(isi) {
  const badan = JSON.stringify(isi), t = Math.floor(Date.now() / 1000);
  const tanda = createHmac('sha256', RAHASIA).update(`${t}\n${badan}`).digest('hex');
  try {
    const r = await fetch(`${TUJUAN}/masuk/bing`, {method: 'POST', headers: {'content-type': 'application/json', 'x-laporan-waktu': String(t), 'x-laporan-tanda': tanda}, body: badan, signal: AbortSignal.timeout(20000)});
    return {status: r.status, byte: Buffer.byteLength(badan)};
  } catch (error) { return {status: null, byte: Buffer.byteLength(badan), galat: error?.name ?? 'galat'}; }
}

if (KUNCI.length < 16 || RAHASIA.length < 32) { console.log('BERHENTI: rahasia BING_WEBMASTER_KEY atau LAPORAN_MASUK_SECRET belum dipasang di repo ini.'); process.exit(1); }
let gagal = 0;
for (const [merek, situs] of Object.entries(SITUS)) {
  const s = await panggil('GetRankAndTrafficStats', situs);
  let isi;
  if (s.gagal) isi = {merek, gagal: s.gagal};
  else {
    await tidur(1500); const q = await panggil('GetQueryStats', situs);
    await tidur(1500); const l = await panggil('GetLinkCounts', situs, '&page=0');
    const catatan = [];
    let kueri = q.j ?? null;
    if (Array.isArray(kueri?.d)) {
      const semua = kueri.d.map((r) => ({Query: r?.Query, Impressions: r?.Impressions, Clicks: r?.Clicks}));
      if (semua.length > MAKS_KUERI) catatan.push(`kata kunci dipotong ke ${MAKS_KUERI} baris tayangan tertinggi dari ${semua.length}`);
      kueri = {d: semua.sort((a, b) => (b.Impressions ?? 0) - (a.Impressions ?? 0)).slice(0, MAKS_KUERI)};
    }
    if (!q.j) catatan.push(`kata kunci tidak terbaca (${q.gagal?.http ? `HTTP ${q.gagal.http}` : 'jaringan'}${q.gagal?.kode !== null && q.gagal?.kode !== undefined ? `, kode ${q.gagal.kode}` : ''})`);
    if (!l.j) catatan.push(`tautan tidak terbaca (${l.gagal?.http ? `HTTP ${l.gagal.http}` : 'jaringan'}${l.gagal?.kode !== null && l.gagal?.kode !== undefined ? `, kode ${l.gagal.kode}` : ''})`);
    isi = {merek, stat: s.j, kueri, tautan: l.j ?? null, catatan};
    console.log(`${merek}: kata kunci ${q.catat} | tautan ${l.catat}`);
  }
  const k = await kirim(isi);
  console.log(`${merek}: statistik ${s.catat} | kirim ke laporan HTTP ${k.status ?? `gagal (${k.galat})`} (${k.byte} byte)`);
  if (s.gagal || k.status !== 200) gagal++;
  await tidur(2000);
}
console.log(gagal ? `SEBAGIAN: ${gagal} dari ${Object.keys(SITUS).length} situs tidak tuntas.` : 'SELESAI: semua situs terkirim.');
process.exit(gagal ? 1 : 0);
