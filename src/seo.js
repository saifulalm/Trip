'use strict';

/**
 * Util SEO open-source (tanpa dependensi eksternal):
 *  - sitemap.xml otomatis dari konten published
 *  - robots.txt dengan hormat-toggle "noindex"
 *  - meta tags (canonical/OG/Twitter) & data terstruktur JSON-LD
 */

function normalizeBase(siteUrl) {
  const base = String(siteUrl || '').trim().replace(/\/+$/, '');
  return base || '';
}

/** URL absolut untuk path tertentu (kosong bila siteUrl belum diatur). */
function absoluteUrl(settings, pathname) {
  const base = normalizeBase(settings && settings.siteUrl);
  if (!base) return '';
  return base + (pathname.startsWith('/') ? pathname : `/${pathname}`);
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const STATIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/destinasi', priority: '0.9', changefreq: 'weekly' },
  { path: '/paket', priority: '0.9', changefreq: 'weekly' },
  { path: '/artikel', priority: '0.7', changefreq: 'weekly' },
  { path: '/tentang', priority: '0.5', changefreq: 'monthly' },
  { path: '/kontak', priority: '0.5', changefreq: 'monthly' }
];

/** Susun isi sitemap.xml dari halaman statis + konten published. */
function buildSitemap(settings, data) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [];

  STATIC_PAGES.forEach((p) => {
    urls.push({ loc: absoluteUrl(settings, p.path), lastmod: today, priority: p.priority, changefreq: p.changefreq });
  });

  const published = (list) => (list || []).filter((x) => x.status === 'published');
  published(data.destinations).forEach((d) => {
    urls.push({
      loc: absoluteUrl(settings, `/destinasi/${d.slug}`),
      lastmod: String(d.updatedAt || d.createdAt || today).slice(0, 10),
      priority: d.featured ? '0.9' : '0.8',
      changefreq: 'monthly'
    });
  });
  published(data.packages).forEach((p) => {
    urls.push({
      loc: absoluteUrl(settings, `/paket/${p.slug}`),
      lastmod: String(p.updatedAt || p.createdAt || today).slice(0, 10),
      priority: p.featured ? '0.9' : '0.8',
      changefreq: 'monthly'
    });
  });
  published(data.articles).forEach((a) => {
    urls.push({
      loc: absoluteUrl(settings, `/artikel/${a.slug}`),
      lastmod: String(a.publishedAt || a.createdAt || today).slice(0, 10),
      priority: '0.6',
      changefreq: 'yearly'
    });
  });

  const body = urls
    .filter((u) => u.loc)
    .map(
      (u) =>
        `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Isi robots.txt — hormati toggle "izinkan mesin pencari". */
function buildRobots(settings) {
  if (settings && settings.seoIndex === false) {
    return 'User-agent: *\nDisallow: /\n';
  }
  const sitemap = absoluteUrl(settings, '/sitemap.xml');
  let out = 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /akun\n';
  if (sitemap) out += `\nSitemap: ${sitemap}\n`;
  return out;
}

/* ---------------- JSON-LD (data terstruktur) ---------------- */

function travelAgency(settings) {
  const out = {
    '@context': 'https://schema.org',
    '@type': 'TravelAgency',
    name: settings.siteName,
    url: normalizeBase(settings.siteUrl) || undefined,
    description: settings.seoDescription || settings.tagline,
    telephone: settings.phone,
    email: settings.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: settings.address,
      addressCountry: 'ID'
    },
    sameAs: [settings.instagram, settings.facebook].filter(Boolean)
  };
  if (settings.logo) out.logo = settings.logo;
  return out;
}

function webSite(settings) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: settings.siteName,
    url: normalizeBase(settings.siteUrl) || undefined,
    description: settings.seoDescription || settings.tagline,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${absoluteUrl(settings, '/destinasi')}?q={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  };
}

function touristAttraction(dest, settings) {
  const out = {
    '@context': 'https://schema.org',
    '@type': 'TouristAttraction',
    name: dest.name,
    description: dest.tagline,
    url: absoluteUrl(settings, `/destinasi/${dest.slug}`) || undefined,
    image: dest.coverImage ? dest.coverImage : undefined
  };
  const lat = Number(dest.lat);
  const lng = Number(dest.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    out.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
  }
  return out;
}

function tourPackage(pkg, settings) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TouristTrip',
    name: pkg.title,
    description: pkg.summary,
    url: absoluteUrl(settings, `/paket/${pkg.slug}`) || undefined,
    touristType: 'Wisatawan domestik & mancanegara',
    offers: {
      '@type': 'Offer',
      price: pkg.price,
      priceCurrency: 'IDR',
      availability: 'https://schema.org/InStock'
    }
  };
}

function article(articleDoc, settings) {
  const out = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: articleDoc.title,
    description: articleDoc.excerpt,
    datePublished: articleDoc.publishedAt || articleDoc.createdAt,
    dateModified: articleDoc.updatedAt || articleDoc.publishedAt || articleDoc.createdAt,
    author: { '@type': 'Organization', name: settings.siteName },
    publisher: {
      '@type': 'Organization',
      name: settings.siteName,
      logo: settings.logo ? { '@type': 'ImageObject', url: settings.logo } : undefined
    },
    mainEntityOfPage: absoluteUrl(settings, `/artikel/${articleDoc.slug}`) || undefined
  };
  if (articleDoc.coverImage) out.image = articleDoc.coverImage;
  return out;
}

module.exports = {
  absoluteUrl,
  buildSitemap,
  buildRobots,
  travelAgency,
  webSite,
  touristAttraction,
  tourPackage,
  article
};