/**
 * Konfeksiyon pipeline — ana ERP (stok.html) ile aynı mantık
 * Kaynak: KUMAS_GELIS satırları + KESIM / YIKAMA_SEVK / YIKAMA_GELEN / KK_GECEN / KONF_SEVK
 */
(function (global) {
  'use strict';

  let _konfGlobalKumasGelisCache = [];
  let _aramaQ = '';
  let _kumasGelisLoadedAt = 0;
  let _kumasGelisInflight = null;
  const KUMAS_CACHE_TTL_MS = 25000;
  /** GEÇİCİ: yıkama adedi kesimde de sayılsın — aşamalar ayrılınca kaldır */
  const GECICI_YIKAMA_KESIM_ESLE = true;

  function userName() {
    const u = global.currentUser;
    return String(u?.display_name || u?.username || 'Sistem').trim() || 'Sistem';
  }
  function toast(m, ok) {
    if (typeof global.showToast === 'function') global.showToast((ok === false ? '❌ ' : '✅ ') + m, ok === false ? 2200 : 1800);
  }
  function esc(s) {
    return typeof global.esc === 'function' ? global.esc(s) : String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }
  function sb() { return global.sb; }
  function getKd(id, tip, force) { return global.getKd(id, tip, force); }
  function sbKdSet(id, tip, kd) { return global.sbKdSet(id, tip, kd); }
  function coerceId(id) {
    return typeof global.coerceSiparisIdForDb === 'function' ? global.coerceSiparisIdForDb(id) : id;
  }
  function siparisById(id) {
    const list = global.siparisler || global.panelSiparisTum || [];
    return list.find(s => String(s.id) === String(id));
  }
  function parseKalemler(s) {
    return typeof global.parseKalemler === 'function' ? global.parseKalemler(s) : [];
  }
  function filtreSiparisId() {
    return global.girisSeciliId || null;
  }
  function simteksIdSet() {
    return global.simteksIds instanceof Set ? global.simteksIds : new Set((global.siparisler || []).map(s => String(s.id)));
  }

  function jsonAdet(j, key, fallback) {
    if (!j || !Object.prototype.hasOwnProperty.call(j, key)) return fallback;
    const raw = j[key];
    if (raw === null || raw === undefined || raw === '') return fallback;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function satirFromRaw(r) {
    let j = {};
    try { j = JSON.parse(r.notlar || '{}') || {}; } catch (e) { j = {}; }
    const sip = siparisById(r.siparis_id);
    const kesAd = parseInt(j.kesilen_adet || 0, 10) || 0;
    const kaliteGec = parseInt(j.kalite_gecen_adet || 0, 10) || 0;
    const sevkEd = parseInt(j.sevk_edilen_adet || 0, 10) || 0;
    return {
      akis_id: r.id,
      siparis_id: r.siparis_id,
      siparis_sno: sip?.sno || String(r.siparis_id || ''),
      firma: sip?.firma || '',
      created_at: r.created_at,
      stok_kodu: j.stok_kodu || r.kalem_ad || '—',
      kumas_cinsi: j.kumas_cinsi || '',
      adet: parseInt(j.adet || 0, 10) || 0,
      durum: j.durum || 'KESIM_BEKLIYOR',
      sonraki_rota: j.sonraki_rota || '',
      kalem_idx: Number.isFinite(parseInt(j.kalem_idx, 10)) ? parseInt(j.kalem_idx, 10) : null,
      kesilen_adet: kesAd,
      renk: j.renk || '',
      yikama_bekleyen_adet: jsonAdet(j, 'yikama_bekleyen_adet', kesAd),
      yikama_sevk_adet: jsonAdet(j, 'yikama_sevk_adet', 0),
      yikama_gelen_adet: jsonAdet(j, 'yikama_gelen_adet', 0),
      kalite_bekleyen_adet: jsonAdet(j, 'kalite_bekleyen_adet', kesAd),
      kalite_gecen_adet: kaliteGec,
      sevk_edilen_adet: sevkEd,
      kalan_adet: Math.max(0, kaliteGec - sevkEd),
      gecici_kesim_onu_sifir: !!j.gecici_kesim_onu_sifir,
      gecici_yikama_onu_sifir: !!j.gecici_yikama_onu_sifir,
      gecici_yikamadaki_sifir: !!j.gecici_yikamadaki_sifir,
      gecici_kalite_onu_sifir: !!j.gecici_kalite_onu_sifir,
      not_json: j
    };
  }

  function uaKalemAsamaVarMi(siparisId, kalemIdx, asamaId) {
    const ua = (global.kdCache || {})['KD_URUN_AGACI_' + siparisId]?.['u_' + kalemIdx] || {};
    return (ua.asamalar || []).map(a => String(a || '').toLowerCase()).includes(String(asamaId || '').toLowerCase());
  }

  function kesimSonrasiRota(siparisId, kalemIdx) {
    const idx = parseInt(kalemIdx, 10);
    if (!Number.isFinite(idx) || idx < 0) return 'KALITE';
    if (uaKalemAsamaVarMi(siparisId, idx, 'parca_yikama')) return 'YIKAMA';
    return 'KALITE';
  }

  function durumEtiket(durum) {
    const m = {
      KESIM_BEKLIYOR: ['Kesim bekliyor', '#8b5cf6'],
      KESIM_KISMEN: ['Kesim kısmi', '#f59e0b'],
      YIKAMA_BEKLIYOR: ['Yıkama bekliyor', '#f59e0b'],
      YIKAMA_KISMEN: ['Yıkama kısmi', '#f59e0b'],
      YIKAMA_TAMAM: ['Yıkama tamam', '#06b6d4'],
      KALITE_BEKLIYOR: ['Kalite bekliyor', '#8b5cf6'],
      KALITE_KISMEN: ['Kalite kısmi', '#f59e0b'],
      KALITE_TAMAM: ['Kalite tamam', '#10b981'],
      SEVK_BEKLIYOR: ['Sevk bekliyor', '#06b6d4'],
      SEVK_TAMAM: ['Sevk tamam', '#5a6280'],
      KESIM_TAMAM: ['Kesim tamam', '#10b981']
    };
    const x = m[durum] || [durum || '—', '#5a6280'];
    return `<span style="font-size:9px;font-weight:800;padding:2px 7px;border-radius:999px;background:${x[1]}22;color:${x[1]}">${esc(x[0])}</span>`;
  }

  function kesimAktifMi(r) {
    return !r.gecici_kesim_onu_sifir
      && (['KESIM_BEKLIYOR', 'KESIM_KISMEN'].includes(String(r.durum || '')) || !r.kesilen_adet);
  }

  function yikamaOzet(r) {
    const j = r.not_json || {};
    const rawBek = r.yikama_bekleyen_adet ?? j.yikama_bekleyen_adet;
    let bek = (rawBek !== undefined && rawBek !== null && rawBek !== '')
      ? (parseInt(rawBek, 10) || 0)
      : (parseInt(r.kesilen_adet || 0, 10) || 0);
    let sevk = parseInt(r.yikama_sevk_adet ?? j.yikama_sevk_adet, 10);
    if (!Number.isFinite(sevk) || sevk < 0) {
      sevk = (bek > 0 && (
        (parseInt(r.yikama_gelen_adet || 0, 10) || 0) > 0
        || ['YIKAMA_BEKLIYOR', 'YIKAMA_KISMEN'].includes(String(r.durum || ''))
      )) ? bek : 0;
    }
    sevk = Math.min(Math.max(0, sevk), bek || sevk);
    let gel = parseInt(r.yikama_gelen_adet || j.yikama_gelen_adet || 0, 10) || 0;
    if (r.gecici_yikama_onu_sifir || j.gecici_yikama_onu_sifir) bek = sevk;
    if (r.gecici_yikamadaki_sifir || j.gecici_yikamadaki_sifir) { sevk = gel; bek = gel; }
    return { bek, sevk, gel, gidecek: Math.max(0, bek - sevk), yikamada: Math.max(0, sevk - gel), gelen: gel };
  }

  function yikamaRotaMu(r) {
    if (String(r.sonraki_rota || '').toUpperCase() === 'KALITE') return false;
    const bek = parseInt(r.yikama_bekleyen_adet || 0, 10) || 0;
    if (bek > 0) return true;
    if ((parseInt(r.kesilen_adet || 0, 10) || 0) > 0 && kesimSonrasiRota(r.siparis_id, r.kalem_idx) === 'YIKAMA') return true;
    return (parseInt(r.yikama_sevk_adet || 0, 10) || 0) > 0 || (parseInt(r.yikama_gelen_adet || 0, 10) || 0) > 0;
  }

  function kaliteHavuz(r) {
    const yikGel = parseInt(r.yikama_gelen_adet || 0, 10) || 0;
    if (yikGel > 0) return yikGel;
    const kes = parseInt(r.kesilen_adet || 0, 10) || 0;
    const kb = parseInt(r.kalite_bekleyen_adet || 0, 10) || 0;
    return Math.max(kes, kb);
  }

  function kaliteOzet(r) {
    const j = r.not_json || {};
    if (r.gecici_kalite_onu_sifir || j.gecici_kalite_onu_sifir) {
      const havuz = kaliteHavuz(r);
      const gec = Math.max(havuz, parseInt(r.kalite_gecen_adet || 0, 10) || 0);
      const sevk = parseInt(r.sevk_edilen_adet || 0, 10) || 0;
      const yikGel = parseInt(r.yikama_gelen_adet || 0, 10) || 0;
      return { havuz, gec, bekleyen: 0, sevk, kalanSevk: Math.max(0, gec - sevk), yikamadan: yikGel > 0, yikamaGelen: yikGel };
    }
    const havuz = kaliteHavuz(r);
    const gec = parseInt(r.kalite_gecen_adet || 0, 10) || 0;
    const sevk = parseInt(r.sevk_edilen_adet || 0, 10) || 0;
    const yikGel = parseInt(r.yikama_gelen_adet || 0, 10) || 0;
    return { havuz, gec, bekleyen: Math.max(0, havuz - gec), sevk, kalanSevk: Math.max(0, gec - sevk), yikamadan: yikGel > 0, yikamaGelen: yikGel };
  }

  function sevkAktifMi(r) {
    const hazir = parseInt(r.kalite_gecen_adet || 0, 10) || 0;
    const sevk = parseInt(r.sevk_edilen_adet || 0, 10) || 0;
    return Math.max(0, hazir - sevk) > 0;
  }

  function rowBlob(r) {
    return [
      r.siparis_sno, r.firma, r.kumas_cinsi, r.stok_kodu, r.renk, r.durum,
      r.sonraki_rota, r.siparis_id,
      r.created_at ? new Date(r.created_at).toLocaleDateString('tr-TR') : ''
    ].join(' ').toLocaleLowerCase('tr-TR');
  }

  function aramaEslesir(r) {
    const q = String(_aramaQ || '').trim().toLocaleLowerCase('tr-TR');
    if (!q) return true;
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const blob = rowBlob(r);
    return tokens.every(t => blob.includes(t));
  }

  function filterRows(rows, filtreId) {
    let out = rows || [];
    const allowed = simteksIdSet();
    if (allowed.size) out = out.filter(r => allowed.has(String(r.siparis_id)));
    if (filtreId) out = out.filter(r => String(r.siparis_id) === String(filtreId));
    if (_aramaQ) out = out.filter(aramaEslesir);
    return out;
  }

  function setArama(q) {
    _aramaQ = String(q || '').trim();
    const asama = global.girisAktifAsama;
    if (!asama) return;
    const area = document.getElementById('giris-form-area');
    if (!area) return;
    const filtre = filtreSiparisId();
    try {
      if (asama === 'kesim') area.innerHTML = renderKesim(filtre);
      else if (asama === 'yikama') area.innerHTML = renderYikama(filtre);
      else if (asama === 'kalite') area.innerHTML = renderKalite(filtre);
      else if (asama === 'sevk') area.innerHTML = renderSevk(filtre);
    } catch (e) {
      yenile();
    }
  }

  async function loadKumasGelis(force) {
    const client = sb();
    if (!client) { _konfGlobalKumasGelisCache = []; return; }
    const now = Date.now();
    if (!force && _konfGlobalKumasGelisCache.length && (now - _kumasGelisLoadedAt) < KUMAS_CACHE_TTL_MS) {
      return;
    }
    if (_kumasGelisInflight) return _kumasGelisInflight;
    _kumasGelisInflight = (async () => {
      try {
        const { data, error } = await client.from('siparis_akis')
          .select('id,created_at,siparis_id,islem,kalem_ad,miktar,notlar')
          .eq('islem', 'KUMAS_GELIS')
          .order('created_at', { ascending: false })
          .limit(400);
        if (error) {
          _konfGlobalKumasGelisCache = [];
          _kumasGelisLoadedAt = 0;
          return;
        }
        _konfGlobalKumasGelisCache = (data || []).map(satirFromRaw);
        _kumasGelisLoadedAt = Date.now();
        /* Ürün ağacı arka planda — listeyi bekletme */
        const filtre = filtreSiparisId();
        let ids = [];
        if (filtre) ids = [filtre];
        else {
          const aktif = _konfGlobalKumasGelisCache.filter(r =>
            kesimAktifMi(r) || yikamaRotaMu(r) || sevkAktifMi(r) || (kaliteOzet(r).bekleyen > 0)
          );
          ids = [...new Set(aktif.map(r => r.siparis_id).filter(Boolean))].slice(0, 12);
        }
        const missing = ids.filter(sid => !(global.kdCache || {})['KD_URUN_AGACI_' + sid]);
        if (missing.length) {
          Promise.all(missing.map(sid => getKd(sid, 'KD_URUN_AGACI', false).catch(() => null)))
            .then(() => {
              const asama = global.girisAktifAsama;
              const area = document.getElementById('giris-form-area');
              if (!asama || !area) return;
              try {
                if (asama === 'kesim') area.innerHTML = renderKesim(filtreSiparisId());
                else if (asama === 'yikama') area.innerHTML = renderYikama(filtreSiparisId());
                else if (asama === 'kalite') area.innerHTML = renderKalite(filtreSiparisId());
                else if (asama === 'sevk') area.innerHTML = renderSevk(filtreSiparisId());
              } catch (e) {}
            });
        }
      } catch (e) {
        _konfGlobalKumasGelisCache = [];
        _kumasGelisLoadedAt = 0;
      } finally {
        _kumasGelisInflight = null;
      }
    })();
    return _kumasGelisInflight;
  }

  async function kayitGuncelle(akisId, patch) {
    const g = _konfGlobalKumasGelisCache.find(r => String(r.akis_id) === String(akisId));
    if (!g) throw new Error('Kayıt bulunamadı');
    const j = { ...(g.not_json || {}), ...patch };
    const { error } = await sb().from('siparis_akis').update({ notlar: JSON.stringify(j) }).eq('id', akisId);
    if (error) throw error;
    return j;
  }

  async function siparisDurumSenkron(siparisId) {
    if (!siparisId) return;
    const kalemler = parseKalemler(siparisById(siparisId) || {});
    const { data, error } = await sb().from('siparis_akis')
      .select('id,islem,kalem_ad,miktar,notlar')
      .eq('siparis_id', siparisId)
      .in('islem', [
        'KUMAS_GELIS', 'KESIM', 'DIKIM', 'YIKAMA_SEVK', 'YIKAMA_GELEN', 'YIKAMA',
        'KK_GECEN', 'KALITE', 'KOLI', 'KONF_SEVK', 'SEVK'
      ]);
    if (error) return;
    const per = {};
    kalemler.forEach((_, i) => {
      per[i] = { kesilen: 0, dikilen: 0, yikSevk: 0, yikGel: 0, kkGec: 0, koli: 0, sevk: 0 };
    });
    let panelYikSevk = 0, panelYikGel = 0;
    (data || []).forEach(r => {
      let j = {};
      try { j = JSON.parse(r.notlar || '{}') || {}; } catch (e) {}
      if (j.panel_silindi || j.silindi) return;
      const islem = String(r.islem || '').toUpperCase().replace(/İ/g, 'I');
      let ki = parseInt(j.kalem_idx, 10);
      if (!Number.isFinite(ki) || ki < 0 || ki >= kalemler.length) ki = -1;
      const mik = parseFloat(r.miktar) || 0;
      if (islem === 'KUMAS_GELIS') {
        if (ki >= 0) {
          per[ki].kesilen += parseInt(j.kesilen_adet || 0, 10) || 0;
          per[ki].yikSevk += parseInt((j.yikama_sevk_adet ?? j.yikama_bekleyen_adet) || 0, 10) || 0;
          per[ki].yikGel += parseInt(j.yikama_gelen_adet || 0, 10) || 0;
          per[ki].kkGec += parseInt(j.kalite_gecen_adet || 0, 10) || 0;
          per[ki].sevk += parseInt(j.sevk_edilen_adet || 0, 10) || 0;
        }
        panelYikSevk += parseInt((j.yikama_sevk_adet ?? j.yikama_bekleyen_adet) || 0, 10) || 0;
        panelYikGel += parseInt(j.yikama_gelen_adet || 0, 10) || 0;
        return;
      }
      if (j.kumas_gelis_id) return;
      if (ki < 0) return;
      if (islem === 'KESIM' && !j.gecici_yikama_kesim_esle) per[ki].kesilen += mik;
      else if (islem === 'DIKIM') per[ki].dikilen += mik;
      else if (islem === 'YIKAMA_SEVK' || islem === 'YIKAMA') {
        per[ki].yikSevk += mik;
        panelYikSevk += mik;
      } else if (islem === 'YIKAMA_GELEN') {
        per[ki].yikGel += mik;
        panelYikGel += mik;
      } else if (islem === 'KK_GECEN' || islem === 'KALITE') per[ki].kkGec += mik;
      else if (islem === 'KOLI') per[ki].koli += mik;
      else if (islem === 'KONF_SEVK' || islem === 'SEVK') per[ki].sevk += mik;
    });
    const kd = (await getKd(siparisId, 'KD_KONFEKSIYON', true)) || {};
    let kesimTop = 0, dikimTop = 0, kkTop = 0, koliTop = 0, sevkTop = 0, yikSevkKalem = 0;
    kalemler.forEach((_, i) => {
      const key = 'kalem_' + i;
      if (!kd[key]) kd[key] = {};
      const p = per[i];
      /* GEÇİCİ: yıkama sevk → kesim */
      if (GECICI_YIKAMA_KESIM_ESLE && p.yikSevk > p.kesilen) p.kesilen = p.yikSevk;
      if (p.kesilen > 0) kd[key].kesilen = Math.max(parseInt(kd[key].kesilen || 0, 10) || 0, Math.round(p.kesilen));
      if (p.dikilen > 0) kd[key].dikilen = Math.max(parseInt(kd[key].dikilen || 0, 10) || 0, Math.round(p.dikilen));
      if (p.yikSevk > 0) kd[key].yikama_sevk = Math.max(parseInt(kd[key].yikama_sevk || 0, 10) || 0, Math.round(p.yikSevk));
      if (p.yikGel > 0) kd[key].yikama_gelen = Math.max(parseInt(kd[key].yikama_gelen || 0, 10) || 0, Math.round(p.yikGel));
      if (p.kkGec > 0) kd[key].kk_gecen = Math.max(parseInt(kd[key].kk_gecen || 0, 10) || 0, Math.round(p.kkGec));
      if (p.koli > 0) kd[key].kolide = Math.max(parseInt(kd[key].kolide || 0, 10) || 0, Math.round(p.koli));
      if (p.sevk > 0) {
        const sev = Math.max(
          parseInt(kd[key].sevk_edilen || 0, 10) || 0,
          parseInt(kd[key].sevk_adet || 0, 10) || 0,
          Math.round(p.sevk)
        );
        kd[key].sevk_edilen = sev;
        kd[key].sevk_adet = sev;
      }
      kesimTop += parseInt(kd[key].kesilen || 0, 10) || 0;
      dikimTop += parseInt(kd[key].dikilen || 0, 10) || 0;
      kkTop += parseInt(kd[key].kk_gecen || 0, 10) || 0;
      koliTop += parseInt(kd[key].kolide || 0, 10) || 0;
      sevkTop += Math.max(parseInt(kd[key].sevk_edilen || 0, 10) || 0, parseInt(kd[key].sevk_adet || 0, 10) || 0);
      yikSevkKalem += parseInt(kd[key].yikama_sevk || 0, 10) || 0;
    });
    kd.kesim_toplam = Math.max(parseInt(kd.kesim_toplam || 0, 10) || 0, kesimTop);
    kd.dikim_toplam = Math.max(parseInt(kd.dikim_toplam || 0, 10) || 0, dikimTop);
    kd.kk_gecen = Math.max(parseInt(kd.kk_gecen || 0, 10) || 0, kkTop);
    kd.koli_toplam = Math.max(parseInt(kd.koli_toplam || 0, 10) || 0, koliTop);
    kd.panel_sevk_toplam = Math.max(parseInt(kd.panel_sevk_toplam || 0, 10) || 0, sevkTop);
    kd.panel_yikama_sevk = Math.max(parseInt(kd.panel_yikama_sevk || 0, 10) || 0, panelYikSevk, yikSevkKalem);
    if (panelYikGel > 0 || yikSevkKalem > 0 || panelYikSevk > 0) {
      kd.panel_yikama_gelen = Math.max(parseInt(kd.panel_yikama_gelen || 0, 10) || 0, panelYikGel);
      kd.yikama_yapildi = true;
    }
    kd.konf_pipeline_son_senkron = new Date().toISOString();
    await sbKdSet(siparisId, 'KD_KONFEKSIYON', kd);
  }

  function cardShell(color, title, count, body) {
    return `<div style="background:var(--surface);border:1px solid ${color}55;border-radius:14px;overflow:hidden;margin-bottom:10px">
      <div style="padding:11px 13px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;background:${color}14">
        <div style="width:7px;height:7px;border-radius:50%;background:${color}"></div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.3px;text-transform:uppercase;flex:1">${title}</div>
        <div style="font-size:10px;color:var(--text3)">${count}</div>
        <button type="button" onclick="KonfPipeline.yenile(true)" style="background:none;border:1px solid var(--border2);border-radius:8px;color:var(--text3);padding:4px 8px;font-size:10px;cursor:pointer">↻</button>
      </div>
      <div style="padding:10px 12px">${body}</div>
    </div>`;
  }

  function emptyBox(msg) {
    return `<div class="empty" style="padding:28px 14px"><div class="icon">📭</div>${msg}</div>`;
  }

  function rowMeta(r) {
    return `<div style="font-size:12px;font-weight:700;margin-bottom:2px">${esc(r.kumas_cinsi || r.stok_kodu || '—')}</div>
      <div style="font-size:10px;color:var(--text3);margin-bottom:8px">${esc(r.siparis_sno)} · ${esc(r.firma || '—')}${r.renk ? ' · ' + esc(r.renk) : ''}</div>`;
  }

  function renderKesim(filtreId) {
    const rows = filterRows(_konfGlobalKumasGelisCache, filtreId);
    const aktif = rows.filter(kesimAktifMi);
    if (!rows.length) {
      return emptyBox('Dokuma Depo\'dan konfeksiyona sevk yok.<br><span style="font-size:10px">Ana programda Dokuma Depo → Konfeksiyon sevk gerekir.</span>');
    }
    if (!aktif.length) {
      return cardShell('#8b5cf6', 'Dokuma Depo → Kesim', 'bekleyen yok', emptyBox('Bekleyen kesim yok.'));
    }
    const body = aktif.map(r => {
      const gelenAd = r.adet || 0;
      const rota = r.sonraki_rota || kesimSonrasiRota(r.siparis_id, r.kalem_idx);
      return `<div class="kalem-girdi">
        ${rowMeta(r)}
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-size:11px">
          <span>Gelen: <b>${gelenAd}</b> ad</span>${durumEtiket(r.durum)}
          <span style="color:var(--cyan)">${rota === 'YIKAMA' ? '→ Yıkama' : '→ Kalite'}</span>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="ad-kes-${r.akis_id}" type="text" class="erp-miktar-input" inputmode="decimal" placeholder="adet"
            value="${gelenAd || ''}" style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text);padding:10px;font-size:16px;text-align:center">
          <button type="button" class="save-btn" style="width:auto;margin:0;padding:10px 14px;background:#8b5cf6"
            onclick="KonfPipeline.kesimKaydet('${r.akis_id}')">Kesim kaydet</button>
        </div>
      </div>`;
    }).join('');
    return cardShell('#8b5cf6', 'Dokuma Depo → Kesim (aktif)', aktif.length + ' bekleyen', body);
  }

  function renderYikama(filtreId) {
    const all = filterRows(_konfGlobalKumasGelisCache.filter(yikamaRotaMu), filtreId);
    const gidecek = all.filter(r => yikamaOzet(r).gidecek > 0);
    const yikamada = all.filter(r => yikamaOzet(r).yikamada > 0);
    if (!all.length) {
      return emptyBox('Yıkama kaydı yok.<br><span style="font-size:10px">Kesim sonrası ürün ağacında <b>Parça Yıkama</b> olanlar burada.</span>');
    }
    let html = '';
    if (gidecek.length) {
      html += cardShell('#f59e0b', 'Yıkamaya gidecek', gidecek.length + ' kayıt', gidecek.map(r => {
        const o = yikamaOzet(r);
        return `<div class="kalem-girdi">${rowMeta(r)}
          <div style="font-size:11px;margin-bottom:8px">Gidecek: <b style="color:var(--amber)">${o.gidecek}</b> ad</div>
          <div style="display:flex;gap:8px">
            <input id="yik-sevk-${r.akis_id}" type="text" class="erp-miktar-input" inputmode="decimal" placeholder="sevk ad" value="${o.gidecek}"
              style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text);padding:10px;font-size:16px;text-align:center">
            <button type="button" class="save-btn" style="width:auto;margin:0;padding:10px 12px;background:#f59e0b"
              onclick="KonfPipeline.yikamaSevkKaydet('${r.akis_id}')">Yıkamaya sevk</button>
          </div></div>`;
      }).join(''));
    }
    if (yikamada.length) {
      html += cardShell('#06b6d4', 'Yıkamada / gelen', yikamada.length + ' kayıt', yikamada.map(r => {
        const o = yikamaOzet(r);
        return `<div class="kalem-girdi">${rowMeta(r)}
          <div style="font-size:11px;margin-bottom:8px">Yıkamada: <b style="color:var(--cyan)">${o.yikamada}</b> · Gelen: <b>${o.gel}</b></div>
          <div style="display:flex;gap:8px">
            <input id="yik-gel-${r.akis_id}" type="text" class="erp-miktar-input" inputmode="decimal" placeholder="gelen ad" value="${o.yikamada}"
              style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text);padding:10px;font-size:16px;text-align:center">
            <button type="button" class="save-btn" style="width:auto;margin:0;padding:10px 12px;background:#06b6d4"
              onclick="KonfPipeline.yikamaGelenKaydet('${r.akis_id}')">Gelen kaydet</button>
          </div></div>`;
      }).join(''));
    }
    if (!html) html = emptyBox('Aktif yıkama işlemi yok.');
    return html;
  }

  function renderKalite(filtreId) {
    let rows = filterRows(_konfGlobalKumasGelisCache, filtreId).filter(r => {
      const o = kaliteOzet(r);
      if (o.bekleyen <= 0 || o.havuz <= 0) return false;
      if (o.yikamadan) return true;
      return String(r.sonraki_rota || '').toUpperCase() === 'KALITE'
        || ['KALITE_BEKLIYOR', 'KALITE_KISMEN', 'KALITE_TAMAM'].includes(String(r.durum || ''));
    });
    if (!rows.length) return emptyBox('Kalite / paket bekleyen ürün yok.');
    const body = rows.map(r => {
      const k = kaliteOzet(r);
      const kaynak = k.yikamadan ? `Yıkama (${k.yikamaGelen} ad)` : 'Direkt kesim';
      return `<div class="kalem-girdi">${rowMeta(r)}
        <div style="font-size:11px;margin-bottom:8px;display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap">
          <span>${esc(kaynak)}</span>
          <span>Havuz <b>${k.havuz}</b> · Paket <b style="color:#8b5cf6">${k.gec}</b> · Bekleyen <b style="color:var(--amber)">${k.bekleyen}</b></span>
        </div>
        <div style="display:flex;gap:8px">
          <input id="kk-gec-${r.akis_id}" type="text" class="erp-miktar-input" inputmode="decimal" placeholder="paket ad" value="${k.bekleyen}"
            style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text);padding:10px;font-size:16px;text-align:center">
          <button type="button" class="save-btn" style="width:auto;margin:0;padding:10px 12px;background:#10b981"
            onclick="KonfPipeline.kaliteKaydet('${r.akis_id}')">Paket kaydet</button>
        </div></div>`;
    }).join('');
    return cardShell('#10b981', 'Kalite / Paket (aktif)', rows.length + ' kayıt', body);
  }

  function renderSevk(filtreId) {
    let all = filterRows(_konfGlobalKumasGelisCache, filtreId).filter(r =>
      ['SEVK_BEKLIYOR', 'KALITE_TAMAM', 'SEVK_TAMAM'].includes(r.durum) || (r.kalite_gecen_adet > 0)
    );
    const rows = all.filter(sevkAktifMi);
    if (!all.length) return emptyBox('Sevk bekleyen ürün yok.<br><span style="font-size:10px">Kalite geçen mallar burada listelenir.</span>');
    if (!rows.length) return cardShell('#ec4899', 'Konfeksiyon Sevk', 'aktif yok', emptyBox('Aktif sevk bekleyen yok.'));
    const body = rows.map(r => {
      const hazir = r.kalite_gecen_adet || 0;
      const sevk = r.sevk_edilen_adet || 0;
      const kalan = Math.max(0, hazir - sevk);
      return `<div class="kalem-girdi">${rowMeta(r)}
        <div style="font-size:11px;margin-bottom:8px;display:flex;justify-content:space-between">
          <span>KK geçen <b style="color:var(--green)">${hazir}</b></span>
          <span>Sevk <b>${sevk}</b></span>
          <span>Kalan <b style="color:var(--amber)">${kalan}</b></span>
        </div>
        <div style="display:flex;gap:8px">
          <input id="sevk-ad-${r.akis_id}" type="text" class="erp-miktar-input" inputmode="decimal" placeholder="sevk ad" value="${kalan}"
            style="flex:1;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;color:var(--text);padding:10px;font-size:16px;text-align:center">
          <button type="button" class="save-btn" style="width:auto;margin:0;padding:10px 12px;background:#ec4899"
            onclick="KonfPipeline.sevkKaydet('${r.akis_id}')">Sevk et</button>
        </div></div>`;
    }).join('');
    return cardShell('#ec4899', 'Kalite → Konfeksiyon Sevk (aktif)', rows.length + ' kayıt', body);
  }

  async function renderAsama(asama) {
    const filtre = filtreSiparisId();
    await loadKumasGelis(false);
    if (asama === 'kesim') return renderKesim(filtre);
    if (asama === 'yikama') return renderYikama(filtre);
    if (asama === 'kalite') return renderKalite(filtre);
    if (asama === 'sevk') return renderSevk(filtre);
    return emptyBox('Alan seçin');
  }

  async function yenile(forceReload) {
    const area = document.getElementById('giris-form-area');
    if (!area) return;
    const asama = global.girisAktifAsama;
    if (!asama) return;
    const aramaEl = document.getElementById('giris-arama');
    if (aramaEl) _aramaQ = String(aramaEl.value || '').trim();

    const paint = () => {
      if (asama === 'kesim') return renderKesim(filtreSiparisId());
      if (asama === 'yikama') return renderYikama(filtreSiparisId());
      if (asama === 'kalite') return renderKalite(filtreSiparisId());
      if (asama === 'sevk') return renderSevk(filtreSiparisId());
      return emptyBox('Alan seçin');
    };

    const hasCache = _konfGlobalKumasGelisCache.length > 0
      && (Date.now() - _kumasGelisLoadedAt) < KUMAS_CACHE_TTL_MS
      && !forceReload;
    if (hasCache) {
      try { area.innerHTML = paint(); } catch (e) {
        area.innerHTML = emptyBox('Çizim hatası: ' + (e.message || e));
      }
      return;
    }

    area.innerHTML = '<div class="loading"><div class="spinner"></div><div style="margin-top:8px;font-size:12px;color:var(--text2)">Liste yükleniyor…</div></div>';
    try {
      const loadPromise = loadKumasGelis(!!forceReload);
      const timeout = new Promise(resolve => setTimeout(resolve, 12000));
      await Promise.race([loadPromise, timeout]);
      area.innerHTML = paint();
    } catch (e) {
      area.innerHTML = emptyBox('Yüklenemedi: ' + (e.message || e));
    }
  }

  function parseAdet(id) {
    const el = document.getElementById(id);
    if (typeof global.erpParseExcelNumberExpr === 'function') return global.erpParseExcelNumberExpr(el?.value || 0);
    return parseInt(String(el?.value || '0').replace(',', '.'), 10) || 0;
  }

  async function kesimKaydet(akisId) {
    const row = _konfGlobalKumasGelisCache.find(r => String(r.akis_id) === String(akisId));
    if (!row) { toast('Kayıt bulunamadı', false); return; }
    const kesAd = parseAdet('ad-kes-' + akisId);
    if (kesAd <= 0) { toast('Kesim adeti girin', false); return; }
    const user = userName();
    const gelAd = parseInt(row.adet || 0, 10) || 0;
    const rota = kesimSonrasiRota(row.siparis_id, row.kalem_idx);
    try {
      await kayitGuncelle(akisId, {
        kesilen_adet: kesAd, kesilen_kg: 0, kesilen_mt: 0,
        kesim_ts: new Date().toISOString(), kesim_user: user,
        fark_adet: gelAd - kesAd,
        kesim_durum: gelAd === kesAd ? 'KESIM_TAMAM' : 'KESIM_KISMEN',
        sonraki_rota: rota,
        durum: rota === 'YIKAMA' ? 'YIKAMA_BEKLIYOR' : 'KALITE_BEKLIYOR',
        yikama_bekleyen_adet: rota === 'YIKAMA' ? kesAd : 0,
        yikama_sevk_adet: 0, yikama_gelen_adet: 0,
        kalite_bekleyen_adet: kesAd, kalite_gecen_adet: 0,
        sevk_edilen_adet: 0, kalan_adet: 0,
        kalem_idx: row.kalem_idx
      });
      await sb().from('siparis_akis').insert([{
        siparis_id: coerceId(row.siparis_id),
        islem: 'KESIM',
        kalem_ad: row.stok_kodu || 'Kumaş',
        miktar: kesAd,
        notlar: JSON.stringify({
          ts: new Date().toISOString(), user,
          note: `Kesim · ${rota === 'YIKAMA' ? '→ Yıkama' : '→ Kalite'} · Gelen: ${gelAd} · Kesilen: ${kesAd}`,
          rota, kalem_idx: row.kalem_idx, kumas_gelis_id: akisId,
          konf_panel: true, pipeline: 'DOKUMA_DEPO_SEVK', kaynak: 'konfeksiyon_panel'
        })
      }]);
      await siparisDurumSenkron(row.siparis_id);
      toast(rota === 'YIKAMA' ? 'Kesim kaydedildi → Yıkama' : 'Kesim kaydedildi → Kalite');
      await yenile(true);
    } catch (e) { toast('Kayıt hatası: ' + (e.message || e), false); }
  }

  async function yikamaSevkKaydet(akisId) {
    const row = _konfGlobalKumasGelisCache.find(r => String(r.akis_id) === String(akisId));
    if (!row) { toast('Kayıt bulunamadı', false); return; }
    const o = yikamaOzet(row);
    const sevkAd = parseAdet('yik-sevk-' + akisId);
    if (sevkAd <= 0) { toast('Yıkamaya sevk adeti girin', false); return; }
    if (sevkAd > o.gidecek) { toast('En fazla ' + o.gidecek + ' adet', false); return; }
    const user = userName();
    const yeniSevk = o.sevk + sevkAd;
    try {
      const hedefKes = Math.max(parseInt(row.kesilen_adet || 0, 10) || 0, o.bek, yeniSevk);
      await kayitGuncelle(akisId, {
        yikama_sevk_adet: yeniSevk,
        yikama_sevk_ts: new Date().toISOString(),
        yikama_sevk_user: user,
        durum: o.gel >= yeniSevk && yeniSevk > 0 ? 'KALITE_BEKLIYOR' : (o.gel > 0 ? 'YIKAMA_KISMEN' : 'YIKAMA_BEKLIYOR'),
        yikama_durum: o.gel >= yeniSevk && yeniSevk > 0 ? 'YIKAMA_TAMAM' : 'YIKAMA_KISMEN',
        /* GEÇİCİ: yıkama ≡ kesim */
        ...(GECICI_YIKAMA_KESIM_ESLE ? { kesilen_adet: hedefKes, gecici_yikama_kesim_esle: true } : {})
      });
      await sb().from('siparis_akis').insert([{
        siparis_id: coerceId(row.siparis_id),
        islem: 'YIKAMA_SEVK',
        kalem_ad: row.stok_kodu || 'Kumaş',
        miktar: sevkAd,
        notlar: JSON.stringify({
          ts: new Date().toISOString(), user, kalem_idx: row.kalem_idx,
          kumas_gelis_id: akisId, konf_panel: true, pipeline: 'DOKUMA_DEPO_SEVK',
          sevk_adet: sevkAd, toplam_sevk: yeniSevk, kaynak: 'konfeksiyon_panel'
        })
      }]);
      if (GECICI_YIKAMA_KESIM_ESLE) {
        await sb().from('siparis_akis').insert([{
          siparis_id: coerceId(row.siparis_id),
          islem: 'KESIM',
          kalem_ad: row.stok_kodu || 'Kumaş',
          miktar: sevkAd,
          notlar: JSON.stringify({
            ts: new Date().toISOString(), user,
            note: 'GEÇİCİ: yıkama ≡ kesim · ' + sevkAd + ' ad',
            gecici_yikama_kesim_esle: true,
            kalem_idx: row.kalem_idx,
            kumas_gelis_id: akisId,
            konf_panel: true, pipeline: 'GECICI_YIKAMA_KESIM', kaynak: 'konfeksiyon_panel'
          })
        }]);
      }
      await siparisDurumSenkron(row.siparis_id);
      toast(sevkAd + ' ad yıkamaya sevk edildi');
      await yenile(true);
    } catch (e) { toast('Kayıt hatası: ' + (e.message || e), false); }
  }

  async function yikamaGelenKaydet(akisId) {
    const row = _konfGlobalKumasGelisCache.find(r => String(r.akis_id) === String(akisId));
    if (!row) { toast('Kayıt bulunamadı', false); return; }
    const o = yikamaOzet(row);
    const gelAd = parseAdet('yik-gel-' + akisId);
    if (gelAd <= 0) { toast('Yıkamadan gelen adet girin', false); return; }
    if (gelAd > o.yikamada) { toast('En fazla ' + o.yikamada + ' adet', false); return; }
    const user = userName();
    const yeniGel = o.gel + gelAd;
    const tamam = yeniGel >= o.sevk && o.sevk > 0;
    const kkO = kaliteOzet({ ...row, yikama_gelen_adet: yeniGel });
    try {
      await kayitGuncelle(akisId, {
        yikama_gelen_adet: yeniGel,
        yikama_ts: new Date().toISOString(),
        yikama_user: user,
        durum: kkO.bekleyen > 0 ? 'KALITE_BEKLIYOR' : (tamam ? 'YIKAMA_TAMAM' : 'YIKAMA_KISMEN'),
        yikama_durum: tamam ? 'YIKAMA_TAMAM' : 'YIKAMA_KISMEN',
        kalite_bekleyen_adet: yeniGel,
        sonraki_rota: 'KALITE'
      });
      await sb().from('siparis_akis').insert([{
        siparis_id: coerceId(row.siparis_id),
        islem: 'YIKAMA_GELEN',
        kalem_ad: row.stok_kodu || 'Kumaş',
        miktar: gelAd,
        notlar: JSON.stringify({
          ts: new Date().toISOString(), user, kalem_idx: row.kalem_idx,
          kumas_gelis_id: akisId, konf_panel: true, pipeline: 'DOKUMA_DEPO_SEVK',
          gelen_adet: gelAd, toplam_gelen: yeniGel, kaynak: 'konfeksiyon_panel'
        })
      }]);
      await siparisDurumSenkron(row.siparis_id);
      toast('Yıkama gelen kaydedildi (+' + gelAd + ')');
      await yenile(true);
    } catch (e) { toast('Kayıt hatası: ' + (e.message || e), false); }
  }

  async function kaliteKaydet(akisId) {
    const row = _konfGlobalKumasGelisCache.find(r => String(r.akis_id) === String(akisId));
    if (!row) { toast('Kayıt bulunamadı', false); return; }
    const k = kaliteOzet(row);
    const gecAd = parseAdet('kk-gec-' + akisId);
    if (gecAd <= 0) { toast('Paket adeti girin', false); return; }
    if (gecAd > k.bekleyen) { toast('En fazla ' + k.bekleyen + ' adet', false); return; }
    const user = userName();
    const yeniGec = k.gec + gecAd;
    const kalanSevk = Math.max(0, yeniGec - k.sevk);
    const bekKalan = Math.max(0, k.havuz - yeniGec);
    try {
      await kayitGuncelle(akisId, {
        kalite_gecen_adet: yeniGec,
        kalite_bekleyen_adet: k.havuz,
        kalite_ts: new Date().toISOString(),
        kalite_user: user,
        durum: bekKalan > 0 ? 'KALITE_KISMEN' : (kalanSevk > 0 ? 'SEVK_BEKLIYOR' : (k.sevk >= yeniGec ? 'SEVK_TAMAM' : 'KALITE_TAMAM')),
        kalan_adet: kalanSevk
      });
      await sb().from('siparis_akis').insert([{
        siparis_id: coerceId(row.siparis_id),
        islem: 'KK_GECEN',
        kalem_ad: row.stok_kodu || 'Kumaş',
        miktar: gecAd,
        notlar: JSON.stringify({
          ts: new Date().toISOString(), user, kalem_idx: row.kalem_idx,
          kumas_gelis_id: akisId, konf_panel: true, pipeline: 'DOKUMA_DEPO_SEVK',
          gecen_adet: gecAd, toplam_gecen: yeniGec, kaynak: 'konfeksiyon_panel'
        })
      }]);
      await siparisDurumSenkron(row.siparis_id);
      toast('Paket kaydedildi (+' + gecAd + ')');
      await yenile(true);
    } catch (e) { toast('Kayıt hatası: ' + (e.message || e), false); }
  }

  async function sevkKaydet(akisId) {
    const row = _konfGlobalKumasGelisCache.find(r => String(r.akis_id) === String(akisId));
    if (!row) { toast('Kayıt bulunamadı', false); return; }
    const hazir = parseInt(row.kalite_gecen_adet || 0, 10) || 0;
    const sevkOnce = parseInt(row.sevk_edilen_adet || 0, 10) || 0;
    const kalan = Math.max(0, hazir - sevkOnce);
    const sevkAd = parseAdet('sevk-ad-' + akisId);
    if (sevkAd <= 0) { toast('Sevk adeti girin', false); return; }
    if (sevkAd > kalan) { toast('En fazla ' + kalan + ' adet', false); return; }
    const user = userName();
    const yeniSevk = sevkOnce + sevkAd;
    const yeniKalan = Math.max(0, hazir - yeniSevk);
    try {
      await kayitGuncelle(akisId, {
        sevk_edilen_adet: yeniSevk,
        kalan_adet: yeniKalan,
        sevk_ts: new Date().toISOString(),
        sevk_user: user,
        durum: yeniKalan > 0 ? 'SEVK_BEKLIYOR' : 'SEVK_TAMAM'
      });
      await sb().from('siparis_akis').insert([{
        siparis_id: coerceId(row.siparis_id),
        islem: 'KONF_SEVK',
        kalem_ad: row.stok_kodu || 'Kumaş',
        miktar: sevkAd,
        notlar: JSON.stringify({
          ts: new Date().toISOString(), user, kalem_idx: row.kalem_idx,
          kumas_gelis_id: akisId, konf_panel: true, pipeline: 'DOKUMA_DEPO_SEVK',
          sevk_adet: sevkAd, toplam_sevk: yeniSevk, kaynak: 'konfeksiyon_panel'
        })
      }]);
      await siparisDurumSenkron(row.siparis_id);
      toast('Sevk edildi (+' + sevkAd + ')');
      await yenile(true);
    } catch (e) { toast('Kayıt hatası: ' + (e.message || e), false); }
  }

  global.KonfPipeline = {
    load: loadKumasGelis,
    yenile,
    renderAsama,
    setArama,
    getArama: () => _aramaQ,
    kesimKaydet,
    yikamaSevkKaydet,
    yikamaGelenKaydet,
    kaliteKaydet,
    sevkKaydet,
    siparisDurumSenkron,
    getCache: () => _konfGlobalKumasGelisCache
  };
})(window);
