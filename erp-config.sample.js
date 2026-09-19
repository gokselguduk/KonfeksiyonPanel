/**
 * Simteks Konfeksiyon Panel — Supabase istemci yapılandırması
 *
 * Yerel/elle kurulum: Bu dosyayı kopyalayıp "erp-config.js" adıyla kaydedin ve
 * değerleri doldurun. Supabase Dashboard → Project Settings → API: Project URL
 * + anon public key.
 *
 * Netlify/Vercel ile otomatik yayında bu adımı YAPMANIZA GEREK YOK —
 * build-config.js, site ayarlarındaki SUPABASE_URL / SUPABASE_ANON_KEY ortam
 * değişkenlerinden erp-config.js'i her yayında kendisi üretir. Bkz. YAYIN-KURULUM.md.
 *
 * Güvenlik: "anon" anahtarı tarayıcıda görünür; bu Supabase'te normaldir.
 * Asıl koruma RLS + erp_* oturum RPC'leri ile sağlanır. service_role anahtarını
 * asla istemciye koymayın.
 */
window.__ERP_SUPABASE = {
    url: 'https://YOUR_PROJECT_REF.supabase.co',
    anonKey: 'YOUR_SUPABASE_ANON_PUBLIC_KEY',
    allowLocalBypass: false
};
