# Konfeksiyon Panel — GitHub Pages ile yayın

Netlify/Vercel kullanılmıyor. Tamamen GitHub üzerinden, ücretsiz.

## 1) Paketle ve yükle

1. **`KONFEKSIYON-PANEL-GITHUB-AT.bat`**'a çift tıklayın.
2. Açılan `_uretilen\konfeksiyon-panel-github\` klasöründeki (erp-config.js
   HARİÇ) tüm dosyaları GitHub'daki deponuza sürükleyin (Commit changes).
3. **Deponuz Private ise** `erp-config.js`'i de (mobil\konfeksiyon-panel
   klasöründen) aynı depoya elle sürükleyip yükleyin. Public depoya
   **koymayın**.

## 2) GitHub Pages'i açın

1. Depo → **Settings → Pages**.
2. **Build and deployment → Source: Deploy from a branch**.
3. Branch: **main**, klasör: **/ (root)** → **Save**.
4. ~1 dakika sonra aynı sayfanın üstünde adresiniz çıkar:
   `https://kullaniciadi.github.io/repo-adi/`

## 3) Gerçek adres

Dosya adı `index.html` değil, açılış adresi:
```
https://kullaniciadi.github.io/repo-adi/konfeksiyon-mobil.html
```

## Güncelleme

Kod değiştikçe: `KONFEKSIYON-PANEL-GITHUB-AT.bat`'ı tekrar çalıştırıp
çıkan dosyaları depoya tekrar sürükleyin (üzerine yazar). GitHub Pages
birkaç dakikada otomatik günceller.
