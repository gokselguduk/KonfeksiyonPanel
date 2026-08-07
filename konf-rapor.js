/**
 * Konfeksiyon işlem raporu — grafik + ürün tipi kırılımı
 * Kesim · Yıkama · Kalite · Sevk — günlük / haftalık / aylık / özel tarih
 */
(function (global) {
  'use strict';

  const ISLEM_SET = [
    'KESIM', 'YIKAMA_SEVK', 'YIKAMA_GELEN', 'YIKAMA',
    'KK_GECEN', 'KALITE', 'KOLI',
    'KONF_SEVK', 'SEVK'
  ];

  const URUN_TIPLERI = [
    { kod: 'DOLGULU', etiket: 'Dolgulu', renk: '#a78bfa' },
    { kod: '4_KATLI', etiket: '4 Katlı', renk: '#818cf8' },
    { kod: 'YASTIK', etiket: 'Yastık', renk: '#f472b6' },
    { kod: 'NEVRESIM', etiket: 'Nevresim', renk: '#38bdf8' },
    { kod: 'PIKE', etiket: 'Pike', renk: '#34d399' },
    { kod: 'YORGAN', etiket: 'Yorgan', renk: '#fbbf24' },
    { kod: 'MUSLIN', etiket: 'Müslin', renk: '#22d3ee' },
    { kod: 'CARSAF', etiket: 'Çarşaf', renk: '#fb7185' },
    { kod: 'HAVLU', etiket: 'Havlu', renk: '#2dd4bf' },
    { kod: 'BATTANIYE', etiket: 'Battaniye', renk: '#c084fc' },
    { kod: 'KIRLENT', etiket: 'Kırlent', renk: '#f59e0b' },
    { kod: 'ALEZ', etiket: 'Alez', renk: '#94a3b8' },
    { kod: 'ORTU', etiket: 'Örtü', renk: '#67e8f9' },
    { kod: 'HALI', etiket: 'Halı', renk: '#e879f9' },
    { kod: 'DIGER', etiket: 'Diğer', renk: '#64748b' }
  ];

  const STAGE_META = {
    kesim: { id: 'kesim', label: 'Kesim', ikon: '✂️', renk: '#8b5cf6', gruplar: ['kesim'] },
    yikama: { id: 'yikama', label: 'Yıkama', ikon: '💧', renk: '#06b6d4', gruplar: ['yikama_sevk', 'yikama_gelen'] },
    kalite: { id: 'kalite', label: 'Kalite', ikon: '🔍', renk: '#10b981', gruplar: ['kalite'] },
    sevk: { id: 'sevk', label: 'Sevk', ikon: '🚚', renk: '#ec4899', gruplar: ['sevk'] }
  };

  let _donem = 'bugun';
  let _bas = '';
  let _bit = '';
  let _arama = '';
  let _rows = [];
  let _cacheKey = '';
  let _loading = false;
  let _hata = '';
  let _openStages = { kesim: true, yikama: false, kalite: false, sevk: false };

  function sb() { return global.sb; }
  function esc(s) {
    return typeof global.esc === 'function'
      ? global.esc(s)
      : String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }
  function fmt(n) { return Math.round(parseFloat(n) || 0).toLocaleString('tr-TR'); }
  function localDateStr(d) {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) return '';
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  function trGun(iso) {
    if (!iso) return '—';
    const p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function sipMap() {
    const list = global.panelSiparisTum || global.siparisler || [];
    const m = new Map();
    list.forEach(s => m.set(String(s.id), s));
    return m;
  }
  function allowedIds() {
    return global.simteksIds instanceof Set ? global.simteksIds : new Set((global.siparisler || []).map(s => String(s.id)));
  }

  function grupKod(islem) {
    const k = String(islem || '').toUpperCase().replace(/İ/g, 'I');
    if (k.startsWith('PANEL_') || k.includes('REVIZE') || k.includes('SILME')) return '';
    if (k === 'KESIM' || k.includes('KESIM')) return 'kesim';
    if (k === 'YIKAMA_SEVK') return 'yikama_sevk';
    if (k === 'YIKAMA_GELEN' || k === 'YIKAMA') return 'yikama_gelen';
    if (k === 'KK_GECEN' || k === 'KALITE' || k === 'KOLI' || k.includes('KALITE') || k.includes('KK')) return 'kalite';
    if (k === 'KONF_SEVK' || k === 'SEVK' || k.includes('SEVK')) return 'sevk';
    return '';
  }

  function parseNot(notlar) {
    if (!notlar) return {};
    if (typeof notlar === 'object') return notlar;
    try { return JSON.parse(notlar); } catch (e) { return {}; }
  }

  function gunStr(row) {
    const j = parseNot(row?.notlar);
    const ts = j.ts || j.tarih || row?.created_at || '';
    const d = new Date(ts);
    return localDateStr(Number.isNaN(d.getTime()) ? row?.created_at : d);
  }

  function urunLabel(row, j) {
    const ad = String(row.kalem_ad || j.kalem_ad || j.urun || j.urun_ad || '').trim();
    if (ad) return ad;
    const pieces = [j.stok_kodu, j.renk || j.kalem_renk, j.kumas_cinsi].filter(Boolean);
    return pieces.length ? pieces.join(' · ') : '—';
  }

  function normTip(v) {
    let s = String(v || '').trim().toUpperCase()
      .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G')
      .replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
      .replace(/[^A-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!s) return '';
    if (s.includes('4') && s.includes('KAT')) return '4_KATLI';
    if (s.includes('DOLGU')) return 'DOLGULU';
    if (s.includes('YASTIK')) return 'YASTIK';
    if (s.includes('NEVRESIM')) return 'NEVRESIM';
    if (s.includes('YORGAN')) return 'YORGAN';
    if (s.includes('MUSLIN') || s.includes('MUSL')) return 'MUSLIN';
    if (s.includes('CARSAF')) return 'CARSAF';
    if (s.includes('PIKE')) return 'PIKE';
    if (s.includes('HAVLU')) return 'HAVLU';
    if (s.includes('BATTANIYE') || s.includes('BATTAN')) return 'BATTANIYE';
    if (s.includes('KIRLENT')) return 'KIRLENT';
    if (s.includes('ALEZ')) return 'ALEZ';
    if (s.includes('ORTU')) return 'ORTU';
    if (s.includes('HALI')) return 'HALI';
    const hit = URUN_TIPLERI.find(t => t.kod === s || s.includes(t.kod));
    return hit ? hit.kod : '';
  }

  function urunTipBul(row, j, sip) {
    const dogrudan = normTip(
      j.urun_grubu || j.urun_tipi || j.urun_tip || j.tip || j.grup ||
      j.kalem_urun_grubu || j.kalem_tip
    );
    if (dogrudan) return dogrudan;
    const kalemIdx = parseInt(j.kalem_idx, 10);
    if (sip && Number.isFinite(kalemIdx) && kalemIdx >= 0) {
      let kalemler = [];
      if (typeof global.parseKalemler === 'function') {
        try { kalemler = global.parseKalemler(sip) || []; } catch (e) { kalemler = []; }
      } else {
        try {
          const raw = sip.cins || sip.kalemler || sip.notlar;
          if (typeof raw === 'string') {
            const p = JSON.parse(raw);
            kalemler = Array.isArray(p) ? p : (p?.kalemler || []);
          } else if (Array.isArray(raw)) kalemler = raw;
          else if (raw && Array.isArray(raw.kalemler)) kalemler = raw.kalemler;
        } catch (e) {}
      }
      const k = kalemler[kalemIdx] || {};
      const fromKalem = normTip(k.urun_grubu || k.urun_tipi || k.tip || k.grup || k.cins || k.ad || k.kod);
      if (fromKalem) return fromKalem;
    }
    const fromText = normTip([row.kalem_ad, j.urun_ad, j.ad, j.urun, sip?.cins].filter(Boolean).join(' '));
    return fromText || 'DIGER';
  }

  function tipEtiket(kod) {
    return (URUN_TIPLERI.find(t => t.kod === kod) || {}).etiket || kod || 'Diğer';
  }
  function tipRenk(kod) {
    return (URUN_TIPLERI.find(t => t.kod === kod) || {}).renk || '#64748b';
  }

  function donemAyarla(d) {
    if (d) _donem = d;
    const bugun = new Date();
    const bugunStr = localDateStr(bugun);
    if (_donem === 'bugun') {
      _bas = _bit = bugunStr;
    } else if (_donem === 'hafta') {
      const h = new Date(bugun);
      const day = h.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      h.setDate(bugun.getDate() + diff);
      _bas = localDateStr(h);
      _bit = bugunStr;
    } else if (_donem === 'ay') {
      _bas = localDateStr(new Date(bugun.getFullYear(), bugun.getMonth(), 1));
      _bit = bugunStr;
    } else {
      const bEl = document.getElementById('rapor-bas');
      const eEl = document.getElementById('rapor-bit');
      if (bEl?.value) _bas = bEl.value;
      if (eEl?.value) _bit = eEl.value;
      if (!_bas) _bas = localDateStr(new Date(bugun.getFullYear(), bugun.getMonth(), 1));
      if (!_bit) _bit = bugunStr;
      if (_bas > _bit) { const t = _bas; _bas = _bit; _bit = t; }
    }
  }

  function ozetTopla(rows) {
    const o = { kesim: 0, yikama_sevk: 0, yikama_gelen: 0, kalite: 0, sevk: 0, kayit: 0 };
    (rows || []).forEach(r => {
      const m = parseFloat(r.miktar) || 0;
      o.kayit += 1;
      if (r.grup === 'kesim') o.kesim += m;
      else if (r.grup === 'yikama_sevk') o.yikama_sevk += m;
      else if (r.grup === 'yikama_gelen') o.yikama_gelen += m;
      else if (r.grup === 'kalite') o.kalite += m;
      else if (r.grup === 'sevk') o.sevk += m;
    });
    return o;
  }

  function filtreArama(rows) {
    const q = String(_arama || '').trim().toLocaleLowerCase('tr-TR');
    if (!q) return rows || [];
    const tokens = q.split(/\s+/).filter(Boolean);
    return (rows || []).filter(r => {
      const blob = [r.sno, r.firma, r.urun, r.islem, r.gun, r.tipEtiket].join(' ').toLocaleLowerCase('tr-TR');
      return tokens.every(t => blob.includes(t));
    });
  }

  /** Belirli aşama satırlarını ürün tipine göre topla */
  function tipBazli(rows, gruplar) {
    const set = new Set(gruplar);
    const map = new Map();
    let top = 0;
    (rows || []).forEach(r => {
      if (!set.has(r.grup)) return;
      const m = parseFloat(r.miktar) || 0;
      if (!m) return;
      top += m;
      const kod = r.tip || 'DIGER';
      map.set(kod, (map.get(kod) || 0) + m);
    });
    const list = [...map.entries()]
      .map(([kod, miktar]) => ({ kod, etiket: tipEtiket(kod), renk: tipRenk(kod), miktar }))
      .sort((a, b) => b.miktar - a.miktar);
    return { top, list };
  }

  function gunlukBazli(rows, gruplar) {
    const set = new Set(gruplar || []);
    const map = new Map();
    (rows || []).forEach(r => {
      if (set.size && !set.has(r.grup)) return;
      const g = r.gun || '—';
      if (!map.has(g)) map.set(g, { gun: g, miktar: 0, kayit: 0 });
      const t = map.get(g);
      t.miktar += parseFloat(r.miktar) || 0;
      t.kayit += 1;
    });
    return [...map.values()].sort((a, b) => String(b.gun).localeCompare(String(a.gun)));
  }

  async function yukle(force) {
    donemAyarla();
    const key = _bas + '|' + _bit;
    if (!force && _cacheKey === key) return _rows;
    if (_loading) return _rows;
    _loading = true;
    _hata = '';
    try {
      const client = sb();
      if (!client) throw new Error('Bağlantı yok');
      let q = client.from('siparis_akis')
        .select('id,created_at,siparis_id,islem,kalem_ad,miktar,notlar')
        .in('islem', ISLEM_SET)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (_bas) q = q.gte('created_at', _bas + 'T00:00:00');
      if (_bit) {
        const bitEx = new Date(_bit + 'T00:00:00');
        if (!Number.isNaN(bitEx.getTime())) {
          bitEx.setDate(bitEx.getDate() + 1);
          q = q.lt('created_at', localDateStr(bitEx) + 'T00:00:00');
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      const map = sipMap();
      const allowed = allowedIds();
      _rows = (data || []).map(r => {
        const j = parseNot(r.notlar);
        const grup = grupKod(r.islem);
        const sip = map.get(String(r.siparis_id));
        const tip = urunTipBul(r, j, sip);
        return {
          id: r.id,
          siparis_id: r.siparis_id,
          sno: sip?.sno || String(r.siparis_id || '—'),
          firma: sip?.firma || '',
          islem: r.islem,
          grup,
          gun: gunStr(r),
          miktar: parseFloat(r.miktar) || 0,
          urun: urunLabel(r, j),
          tip,
          tipEtiket: tipEtiket(tip),
          silindi: !!(j.panel_silindi || j.silindi)
        };
      }).filter(r => {
        if (!r.grup || r.silindi) return false;
        if (allowed.size && !allowed.has(String(r.siparis_id))) return false;
        if (_bas && r.gun && r.gun < _bas) return false;
        if (_bit && r.gun && r.gun > _bit) return false;
        return true;
      });
      _cacheKey = key;
    } catch (e) {
      _hata = e?.message || String(e);
      _rows = [];
      _cacheKey = '';
    } finally {
      _loading = false;
    }
    return _rows;
  }

  function barGrafik(list, top, renkVarsayilan) {
    if (!list.length) {
      return `<div style="font-size:11px;color:var(--text3);padding:8px 0">Bu dönemde kayıt yok.</div>`;
    }
    const max = Math.max(top, ...list.map(x => x.miktar), 1);
    return list.map(x => {
      const pct = Math.max(2, Math.round((x.miktar / max) * 100));
      const renk = x.renk || renkVarsayilan;
      return `<div class="rapor-bar-row">
        <div class="rapor-bar-lbl" title="${esc(x.etiket)}">${esc(x.etiket)}</div>
        <div class="rapor-bar-track"><div class="rapor-bar-fill" style="width:${pct}%;background:${renk}"></div></div>
        <div class="rapor-bar-val" style="color:${renk}">${fmt(x.miktar)}</div>
      </div>`;
    }).join('');
  }

  function miniGunChart(gunler, renk) {
    if (!gunler.length) return '';
    const max = Math.max(...gunler.map(g => g.miktar), 1);
    const son = gunler.slice(0, 7).reverse();
    return `<div style="margin-top:10px">
      <div style="font-size:9px;font-weight:800;color:var(--text3);text-transform:uppercase;margin-bottom:6px">Günlük trend</div>
      <div style="display:flex;align-items:flex-end;gap:4px;height:56px">
        ${son.map(g => {
          const h = Math.max(4, Math.round((g.miktar / max) * 52));
          return `<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px" title="${esc(trGun(g.gun))}: ${fmt(g.miktar)}">
            <div style="width:100%;height:${h}px;background:${renk};border-radius:4px 4px 2px 2px;opacity:.9"></div>
            <div style="font-size:7px;color:var(--text3);white-space:nowrap">${esc(String(g.gun || '').slice(8) || '—')}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  function stagePanel(stageKey, rows) {
    const st = STAGE_META[stageKey];
    if (!st) return '';
    const open = !!_openStages[stageKey];
    let top = 0;
    let alt = '';
    if (stageKey === 'yikama') {
      const sevk = tipBazli(rows, ['yikama_sevk']);
      const gel = tipBazli(rows, ['yikama_gelen']);
      top = gel.top || sevk.top;
      const birlesik = new Map();
      [...sevk.list, ...gel.list].forEach(x => {
        birlesik.set(x.kod, (birlesik.get(x.kod) || 0) + x.miktar);
      });
      /* Gelen öncelikli gösterim; yoksa sevk */
      const tipData = gel.top > 0 ? gel : sevk;
      const list = tipData.list;
      alt = `Sevk ${fmt(sevk.top)} · Gelen ${fmt(gel.top)}`;
      const gunler = gunlukBazli(rows, st.gruplar);
      return `<div class="rapor-stage${open ? ' open' : ''}" id="rapor-stage-${st.id}">
        <button type="button" class="rapor-stage-head" onclick="KonfRapor.stageToggle('${st.id}')">
          <span>${st.ikon}</span>
          <span style="flex:1;font-size:12px;font-weight:800">${st.label}</span>
          <span style="font-size:16px;font-weight:900;color:${st.renk}">${fmt(top)}</span>
          <span class="ha-chev" style="margin-left:6px;font-size:11px;color:var(--text3);transition:transform .2s">▼</span>
        </button>
        <div class="rapor-stage-body">
          <div style="font-size:10px;color:var(--text3);margin:8px 0 10px">${alt}</div>
          <div style="font-size:9px;font-weight:800;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Ürün tipi dağılımı</div>
          ${barGrafik(list, tipData.top, st.renk)}
          ${miniGunChart(gunler, st.renk)}
        </div>
      </div>`;
    }
    const tipData = tipBazli(rows, st.gruplar);
    top = tipData.top;
    const gunler = gunlukBazli(rows, st.gruplar);
    return `<div class="rapor-stage${open ? ' open' : ''}" id="rapor-stage-${st.id}">
      <button type="button" class="rapor-stage-head" onclick="KonfRapor.stageToggle('${st.id}')">
        <span>${st.ikon}</span>
        <span style="flex:1;font-size:12px;font-weight:800">Toplam ${st.label.toLowerCase()}</span>
        <span style="font-size:16px;font-weight:900;color:${st.renk}">${fmt(top)}</span>
        <span class="ha-chev" style="margin-left:6px;font-size:11px;color:var(--text3);transition:transform .2s">▼</span>
      </button>
      <div class="rapor-stage-body">
        <div style="font-size:9px;font-weight:800;color:var(--text3);text-transform:uppercase;margin:8px 0">Ürün tipi · dolgulu / 4 katlı / yastık…</div>
        ${barGrafik(tipData.list, tipData.top, st.renk)}
        ${miniGunChart(gunler, st.renk)}
        ${tipData.list.length ? `<div style="font-size:10px;color:var(--text3);margin-top:8px;line-height:1.45">${tipData.list.slice(0, 6).map(x => `<b style="color:${x.renk}">${esc(x.etiket)}</b>: ${fmt(x.miktar)}`).join(' · ')}</div>` : ''}
      </div>
    </div>`;
  }

  function pill(id, label) {
    const on = _donem === id;
    return `<button type="button" onclick="KonfRapor.donemSec('${id}')"
      style="padding:8px 12px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${on ? 'rgba(99,102,241,.5)' : 'var(--border)'};background:${on ? 'rgba(99,102,241,.2)' : 'var(--surface2)'};color:${on ? 'var(--accent2)' : 'var(--text3)'};cursor:pointer;font-family:inherit">${label}</button>`;
  }

  function renderShell(body) {
    const donemLbl = _bas && _bit
      ? (_bas === _bit ? trGun(_bas) : trGun(_bas) + ' — ' + trGun(_bit))
      : '—';
    return `<div style="margin-bottom:4px">
      <div style="font-size:11px;color:var(--text3);margin-bottom:10px;line-height:1.4">
        Dönem seçin · kesim / yıkama / kalite / sevk ürün tipiyle grafikte görünür.
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${pill('bugun', 'Günlük')}
        ${pill('hafta', 'Haftalık')}
        ${pill('ay', 'Aylık')}
        ${pill('ozel', 'Tarih')}
        <button type="button" onclick="KonfRapor.yenile(true)" style="margin-left:auto;padding:8px 12px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid var(--border2);background:var(--surface2);color:var(--text2);cursor:pointer;font-family:inherit">↻</button>
      </div>
      <div style="display:${_donem === 'ozel' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <label class="field-label">Başlangıç</label>
          <input type="date" id="rapor-bas" class="field-input" value="${esc(_bas)}" onchange="KonfRapor.ozelTarih()" style="margin-bottom:0">
        </div>
        <div>
          <label class="field-label">Bitiş</label>
          <input type="date" id="rapor-bit" class="field-input" value="${esc(_bit)}" onchange="KonfRapor.ozelTarih()" style="margin-bottom:0">
        </div>
      </div>
      <input id="rapor-arama" class="field-input" type="search" placeholder="🔍 Sipariş / müşteri / ürün / tip ara…"
        value="${esc(_arama)}" oninput="KonfRapor.arama(this.value)" style="margin-bottom:8px;font-size:14px">
      <div style="font-size:10px;color:var(--text3);margin-bottom:10px">Dönem: <b style="color:var(--text2)">${esc(donemLbl)}</b></div>
    </div>${body}`;
  }

  function renderIcerik(allRows) {
    const rows = filtreArama(allRows);
    const o = ozetTopla(rows);
    let body = '';
    if (_hata) {
      body += `<div class="empty"><div class="icon">⚠️</div>${esc(_hata)}</div>`;
      return renderShell(body);
    }

    body += `<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin-bottom:12px">
      ${[['Kesim', o.kesim, '#8b5cf6'], ['Yıkama', o.yikama_gelen || o.yikama_sevk, '#06b6d4'], ['Kalite', o.kalite, '#10b981'], ['Sevk', o.sevk, '#ec4899']].map(([l, v, c]) =>
        `<div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:8px 6px;text-align:center">
          <div style="font-size:8px;font-weight:800;color:var(--text3);text-transform:uppercase">${l}</div>
          <div style="font-size:15px;font-weight:900;color:${c};margin-top:3px">${fmt(v)}</div>
        </div>`
      ).join('')}
    </div>`;

    body += stagePanel('kesim', rows);
    body += stagePanel('yikama', rows);
    body += stagePanel('kalite', rows);
    body += stagePanel('sevk', rows);

    if (!rows.length) {
      body += `<div class="empty" style="padding:20px"><div class="icon">📭</div>Bu dönemde kayıt yok.</div>`;
    }

    return renderShell(body);
  }

  let _aramaTimer = null;
  async function yenile(force) {
    const root = document.getElementById('rapor-root');
    if (!root) return;
    donemAyarla();
    root.innerHTML = renderShell('<div class="loading"><div class="spinner"></div><div style="margin-top:8px;font-size:12px;color:var(--text2)">Rapor yükleniyor…</div></div>');
    const rows = await yukle(!!force);
    root.innerHTML = renderIcerik(rows);
  }

  function donemSec(d) {
    _donem = d || 'bugun';
    if (_donem !== 'ozel') donemAyarla(_donem);
    yenile(true);
  }

  function ozelTarih() {
    _donem = 'ozel';
    const bEl = document.getElementById('rapor-bas');
    const eEl = document.getElementById('rapor-bit');
    if (bEl?.value) _bas = bEl.value;
    if (eEl?.value) _bit = eEl.value;
    yenile(true);
  }

  function stageToggle(id) {
    _openStages[id] = !_openStages[id];
    const root = document.getElementById('rapor-root');
    if (!root) return;
    root.innerHTML = renderIcerik(_rows);
  }

  function arama(q) {
    _arama = String(q || '');
    clearTimeout(_aramaTimer);
    _aramaTimer = setTimeout(() => {
      const root = document.getElementById('rapor-root');
      if (!root) return;
      const focusPos = document.getElementById('rapor-arama')?.selectionStart;
      root.innerHTML = renderIcerik(_rows);
      const el = document.getElementById('rapor-arama');
      if (el) {
        el.focus();
        try { if (typeof focusPos === 'number') el.setSelectionRange(focusPos, focusPos); } catch (e) {}
      }
    }, 120);
  }

  global.KonfRapor = {
    yenile,
    donemSec,
    ozelTarih,
    arama,
    stageToggle,
    kirilimSec: () => {}
  };
})(window);
