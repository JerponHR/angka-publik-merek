#!/usr/bin/env node
// Pengambil halaman publik TikTok untuk laporan email, dibuat supaya TIDAK bergantung pada Mac (permintaan Rico 10 Nov 2026).
// Berdiri sendiri (tanpa dependensi, Node 20+): ambil https://www.tiktok.com/embed/@akun tanpa login, urai, lalu tulis ke
// Cloudflare KV lewat REST dengan kunci laporan:tiktok-publik:v1:<merek>:<akun>. Pembacanya: worker rico-brand-reports,
// pusat/tiktok.mjs bacaKvPublik (bentuk isi dan aturan sahnya ada di sana; pengurai di bawah adalah SALINAN uraiEmbedTikTok,
// dijaga sama oleh uji banding.mjs).
//   node ambil.mjs                              # kering: ambil, urai, cetak; tidak menulis apa pun
//   node ambil.mjs --berkas data/tiktok-publik.json   # tulis hasil ke berkas (dipakai GitHub Actions; tanpa token)
// Akun yang gagal DILEWATI dan dicatat; tidak pernah menulis angka tebakan. Keluar 1 bila tidak satu akun pun berhasil.
export const AKUN = [['evora', '@evora.circle'], ['jerpon', '@jerukpontianakhr'], ['pokebawl', '@pokebawl0'], ['pokebawl', '@pokebawl1'], ['firstclass', '@firstclass.tattoo']];
const bulat = (v) => Number.isSafeInteger(v) && v >= 0;
export const kunci = (merek, handle) => `laporan:tiktok-publik:v1:${merek}:${handle.slice(1).toLowerCase()}`;
export function urai(html, handle) {
  const m = String(html).match(/<script[^>]+id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return {galat: 'tidak memuat data akun'};
  let d; try { d = JSON.parse(m[1]); } catch { return {galat: 'tidak memuat data akun'}; }
  const data = d?.source?.data ?? {};
  const k = Object.keys(data).find((x) => x.toLowerCase() === `/embed/${handle}`.toLowerCase());
  const blok = k ? data[k] : null, u = blok?.userInfo, unik = String(u?.uniqueId ?? '');
  if (!u || !unik || !bulat(u.followerCount)) return {galat: 'tidak memuat data akun'};
  if (unik.toLowerCase() !== handle.slice(1).toLowerCase()) return {akunLain: unik.slice(0, 40)};
  const video = (Array.isArray(blok.videoList) ? blok.videoList : []).filter((v) => /^\d{6,20}$/.test(String(v?.id ?? '')) && !v.privateItem
    && (v.authorUniqueId === undefined || String(v.authorUniqueId).toLowerCase() === unik.toLowerCase()))
    .map((v) => ({id: String(v.id), terbit: new Date(Number(BigInt(v.id) >> 32n) * 1000 + 7 * 3600000).toISOString().slice(0, 10), tayang: bulat(v.playCount) ? v.playCount : null}))
    .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)).slice(0, 5);
  return {pengikut: u.followerCount, suka: bulat(u.heartCount) ? u.heartCount : null, video};
}
// Mode berkas (dipakai GitHub Actions, TANPA token apa pun): hasil ditulis ke satu berkas JSON di repo publik, lalu worker
// laporan membacanya lewat raw.githubusercontent.com. Akun yang gagal diambil mempertahankan isi lamanya di berkas itu
// (dibacaAt lama), dan worker menolak bacaan yang bukan milik hari laporan, jadi angka basi tidak pernah tampil sebagai baru.
async function utama() {
  const {readFileSync, writeFileSync, mkdirSync} = await import('node:fs');
  const i = process.argv.indexOf('--berkas'), berkas = i > 0 ? process.argv[i + 1] : null;
  let lama = {}; try { lama = JSON.parse(readFileSync(berkas, 'utf8')).akun ?? {}; } catch {}
  const akun = {...lama}; let ok = 0;
  for (const [merek, handle] of AKUN) {
    const k = `${merek}:${handle.slice(1).toLowerCase()}`;
    try {
      const r = await fetch(`https://www.tiktok.com/embed/${handle}`, {headers: {'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'}, signal: AbortSignal.timeout(25000)});
      if (!r.ok) { console.log(`${merek}\t${handle}\tDILEWATI: HTTP ${r.status}`); continue; }
      const d = urai(await r.text(), handle);
      if (d.akunLain !== undefined) { console.log(`${merek}\t${handle}\tDILEWATI: halaman memuat akun lain`); continue; }
      if (d.galat) { console.log(`${merek}\t${handle}\tDILEWATI: ${d.galat}`); continue; }
      akun[k] = {versi: 1, merek, handle, dibacaAt: new Date().toISOString(), pengikut: d.pengikut, suka: d.suka, video: d.video};
      console.log(`${merek}\t${handle}\tTERBACA pengikut ${d.pengikut}, suka ${d.suka}, video ${d.video.length}`); ok++;
    } catch (e) { console.log(`${merek}\t${handle}\tDILEWATI: tidak terjangkau (${e?.name ?? 'galat'})`); }
  }
  if (berkas && ok) { mkdirSync(new URL('.', `file://${berkas.startsWith('/') ? berkas : `${process.cwd()}/${berkas}`}`), {recursive: true}); writeFileSync(berkas, JSON.stringify({versi: 1, dibuatAt: new Date().toISOString(), akun}, null, 1) + '\n'); console.log(`ditulis ${berkas}`); }
  process.exit(ok ? 0 : 1);
}
if (import.meta.url === `file://${process.argv[1]}`) await utama();
