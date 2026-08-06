/**
 * Konfeksiyon işlem raporu — ana ERP KONF_ISLEM ile aynı kaynak
 */
(function (global) {
  'use strict';

  const ISLEM_SET = [
    'KESIM', 'YIKAMA_SEVK', 'YIKAMA_GELEN', 'YIKAMA',
    'KK_GECEN', 'KALITE', 'KOLI',
    'KONF_SEVK', 'SEVK'
  ];

  let _donem = 'hafta';
  let _bas = '';
  let _bit = '';
  let _rows = [];
  let _cacheKey = '';
  let _loading = false;
  let _hata = '';

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
    const ad = String(row.kalem_ad || j.kalem_ad || j.urun || '').trim();
    if (ad) return ad;
    const pieces = [j.stok_kodu, j.renk || j.kalem_renk, j.kumas_cinsi].filter(Boolean);
    return pieces.length ? pieces.join(' · ') : '—';
  }

  function donemAyarla(d) {
    _donem = d || _donem || 'hafta';
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
      /* ozel — inputlardan */
      const bEl = document.getElementById('rapor-bas');
      const eEl = document.getElementById('rapor-bit');
      if (bEl?.value) _bas = bEl.value;
      if (eEl?.value) _bit = eEl.value;
      if (!_bas || !_bit) {
        _bas = localDateStr(new Date(bugun.getFullYear(), bugun.getMonth(), 1));
        _bit = bugunStr;
      }
    }
  }

  function ozetTopla(rows) {
    const o = { kesim: 0, yikama_sevk: 0, yikama_gelen: 0, kalite: 0, sevk: 0 };
    (rows || []).forEach(r => {
      const m = parseFloat(r.miktar) || 0;
      if (r.grup === 'kesim') o.kesim += m;
      else if (r.grup === 'yikama_sevk') o.yikama_sevk += m;
      else if (r.grup === 'yikama_gelen') o.yikama_gelen += m;
      else if (r.grup === 'kalite') o.kalite += m;
      else if (r.grup === 'sevk') o.sevk += m;
    });
    return o;
  }

  function siparisBazli(rows) {
    const map = new Map();
    (rows || []).forEach(r => {
      const key = String(r.siparis_id);
      if (!map.has(key)) {
        map.set(key, {
          siparis_id: r.siparis_id,
          sno: r.sno,
          firma: r.firma,
          kesim: 0, yikama_sevk: 0, yikama_gelen: 0, kalite: 0, sevk: 0,
          son: r.gun || ''
        });
      }
      const t = map.get(key);
      const m = parseFloat(r.miktar) || 0;
      if (r.grup === 'kesim') t.kesim += m;
      else if (r.grup === 'yikama_sevk') t.yikama_sevk += m;
      else if (r.grup === 'yikama_gelen') t.yikama_gelen += m;
      else if (r.grup === 'kalite') t.kalite += m;
      else if (r.grup === 'sevk') t.sevk += m;
      if (r.gun && (!t.son || r.gun > t.son)) t.son = r.gun;
    });
    return [...map.values()].sort((a, b) => String(b.son).localeCompare(String(a.son)));
  }

  async function yukle(force) {
    donemAyarla(_donem);
    const key = _bas + '|' + _bit;
    if (!force && _cacheKey === key && _rows.length) return _rows;
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
        .limit(3000);
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
        return {
          id: r.id,
          siparis_id: r.siparis_id,
          sno: sip?.sno || String(r.siparis_id || '—'),
          firma: sip?.firma || '',
          islem: r.islem,
          grup,
          gun: gunStr(r),
          miktar: parseFloat(r.miktar) || 0,
          urun: urunLabel(r, j)
        };
      }).filter(r => {
        if (!r.grup) return false;
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

  function kart(lbl, val, clr) {
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 12px;border-left:3px solid ${clr}">
      <div style="font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text3)">${lbl}</div>
      <div style="font-size:22px;font-weight:800;color:${clr};margin-top:4px;line-height:1">${fmt(val)}</div>
    </div>`;
  }

  function pill(id, label) {
    const on = _donem === id;
    return `<button type="button" onclick="KonfRapor.donemSec('${id}')"
      style="padding:7px 12px;border-radius:999px;font-size:11px;font-weight:800;border:1px solid ${on ? 'rgba(99,102,241,.45)' : 'var(--border)'};background:${on ? 'rgba(99,102,241,.18)' : 'var(--surface2)'};color:${on ? 'var(--accent2)' : 'var(--text3)'};cursor:pointer;font-family:inherit">${label}</button>`;
  }

  function renderShell(body) {
    const donemLbl = _bas && _bit
      ? (_bas === _bit ? _bas : _bas + ' — ' + _bit)
      : '—';
    return `<div class="sel-card" style="margin-bottom:12px">
      <div class="sec-title" style="margin-bottom:8px">İşlem Raporu</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
        ${pill('bugun', 'Bugün')}
        ${pill('hafta', 'Bu hafta')}
        ${pill('ay', 'Bu ay')}
        ${pill('ozel', 'Özel')}
        <button type="button" onclick="KonfRapor.yenile(true)" style="margin-left:auto;padding:7px 12px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid var(--border2);background:var(--surface2);color:var(--text2);cursor:pointer;font-family:inherit">↻ Yenile</button>
      </div>
      ${_donem === 'ozel' ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div><label class="field-label">Başlangıç</label><input type="date" id="rapor-bas" class="field-input" value="${esc(_bas)}" onchange="KonfRapor.ozelTarih()" style="margin-bottom:0"></div>
        <div><label class="field-label">Bitiş</label><input type="date" id="rapor-bit" class="field-input" value="${esc(_bit)}" onchange="KonfRapor.ozelTarih()" style="margin-bottom:0"></div>
      </div>` : ''}
      <div style="font-size:10px;color:var(--text3)">${esc(donemLbl)} · ana program Konfeksiyon İşlem raporu</div>
    </div>${body}`;
  }

  function renderIcerik(rows) {
    const o = ozetTopla(rows);
    const sipList = siparisBazli(rows);
    let body = '';
    if (_hata) {
      body += `<div class="empty"><div class="icon">⚠️</div>${esc(_hata)}</div>`;
    } else {
      body += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        ${kart('Kesim', o.kesim, '#8b5cf6')}
        ${kart('Yıkamaya', o.yikama_sevk, '#f59e0b')}
        ${kart('Yıkamadan', o.yikama_gelen, '#06b6d4')}
        ${kart('Kalite / Paket', o.kalite, '#10b981')}
        ${kart('Sevk', o.sevk, '#ec4899')}
        ${kart('Sipariş', sipList.length, '#6366f1')}
      </div>`;
      if (!sipList.length) {
        body += `<div class="empty"><div class="icon">📭</div>Bu dönemde işlem kaydı yok.</div>`;
      } else {
        body += `<div class="sec-title" style="margin-bottom:8px">Sipariş özeti · ${sipList.length}</div>`;
        body += sipList.map(s => {
          const cells = [
            ['Kesim', s.kesim, '#8b5cf6'],
            ['Yık.→', s.yikama_sevk, '#f59e0b'],
            ['Yık.←', s.yikama_gelen, '#06b6d4'],
            ['KK', s.kalite, '#10b981'],
            ['Sevk', s.sevk, '#ec4899']
          ].map(([l, v, c]) => `<div style="text-align:center">
              <div style="font-size:8px;color:var(--text3);font-weight:700;text-transform:uppercase">${l}</div>
              <div style="font-size:13px;font-weight:800;color:${c}">${v ? fmt(v) : '—'}</div>
            </div>`).join('');
          return `<div class="siparis-card" style="cursor:default;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px">
              <div>
                <div style="font-size:14px;font-weight:800">${esc(s.sno)}</div>
                <div style="font-size:11px;color:var(--text3)">${esc(s.firma || '—')}</div>
              </div>
              <div style="font-size:10px;color:var(--text3)">${esc(s.son || '')}</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px">${cells}</div>
          </div>`;
        }).join('');
      }
    }
    return renderShell(body);
  }

  async function yenile(force) {
    const root = document.getElementById('rapor-root');
    if (!root) return;
    donemAyarla(_donem);
    root.innerHTML = renderShell('<div class="loading"><div class="spinner"></div><div style="margin-top:8px;font-size:12px;color:var(--text2)">Rapor yükleniyor…</div></div>');
    const rows = await yukle(!!force);
    root.innerHTML = renderIcerik(rows);
  }

  function donemSec(d) {
    _donem = d;
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

  global.KonfRapor = {
    yenile,
    donemSec,
    ozelTarih,
    getDonem: () => ({ donem: _donem, bas: _bas, bit: _bit })
  };
})(window);
