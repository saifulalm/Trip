'use strict';

/**
 * Data awal (seed) untuk website Seayoulatertrip.
 * Dijalankan otomatis saat server start bila database kosong,
 * atau paksa ulang dengan: npm run seed
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const BRAND = require('./brand');

function buildSeed() {
  const now = new Date().toISOString();
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString();

  const destinations = [
    {
      id: db.uid('dst'),
      slug: 'pulau-sabesi',
      name: 'Pulau Sabesi',
      lat: -0.4719,
      lng: 130.7515,
      region: 'Raja Ampat, Papua Barat Daya',
      tagline: 'Gerbang timur Raja Ampat dengan laguna bening dan desa wisata bahari',
      description:
        'Pulau Sabesi adalah surga bahari kecil di kawasan Raja Ampat yang menyuguhkan perpaduan langka antara desa wisata yang ramah, hutan mangrove, dan taman laut berisi ribuan ikan warna-warni. Dari dermaga Waisai, perjalanan singkat membawa Anda ke air sejernih kaca yang menutupi terumbu karang sehat.\n\nDi sini wisatawan menginap di homestay milik warga desa, menikmati ikan bakar hasil tangkapan harian, dan menyelam di spot-spot yang masih tenang karena belum ramai. Pulau Sabesi cocok bagi Anda yang mencari ketenangan tropis tanpa mengorbankan keindahan bawah laut kelas dunia.',
      highlights: [
        'Snorkeling di Spot Yenbuba dengan ratusan jenis ikan karang',
        'Menyusuri hutan mangrove Sabesi dengan perahu kecil',
        'Homestay bahari milik warga desa setempat',
        'Sunset di dermaga kayu Barat Sabesi',
        'Pertemuan singkat dengan penyu hijau di musim tertentu'
      ],
      bestSeason: 'Oktober – April',
      duration: '3–5 hari',
      gettingThere: 'Pesawat ke Sorong/Waisai, lalu speedboat ± 30 menit ke Sabesi',
      facilities: ['Homestay & penginapan lokal', 'Warung makan desa', 'Rental alat snorkeling', 'Pemandu lokal bersertifikat', 'Listrik genset 24 jam'],
      priceFrom: 1850000,
      image: '/img/dest-sabesi.svg',
      gallery: ['/img/dest-sabesi.svg', '/img/dest-misool.svg', '/img/dest-weh.svg'],
      featured: true,
      status: 'published',
      createdAt: day(30)
    },
    {
      id: db.uid('dst'),
      slug: 'pulau-weh',
      name: 'Pulau Weh',
      lat: 5.5483,
      lng: 95.3238,
      region: 'Sabang, Aceh',
      tagline: 'Titik nol kilometer Indonesia dengan rubiah dan air panas alami',
      description:
        'Pulau Weh adalah ujung barat kepulauan Indonesia yang terkenal dengan Iboih yang tenang, Pantai Sumur Tiga yang memukau, dan kolam air panas alami di Air Hangat. Bawah lautnya termasuk yang terbaik di Sumatra, dengan batu raksasa dan terumbu yang masih lestari.',
      highlights: [
        'Menyusuri Pantai Iboih dengan perahu kaca',
        'Berenang di kolam air panas alami Air Hangat',
        'Berkunjung ke monument Nol Kilometer',
        'Snorkeling di Pulau Rubiah'
      ],
      bestSeason: 'Mei – September',
      duration: '3–4 hari',
      gettingThere: 'Pesawat ke Bandara Maimun Saleh (SBG) atau feri dari Banda Aceh',
      facilities: ['Resor & cottage tepi pantai', 'Rumah makan seafood', 'Sewa kapal & alat selam'],
      priceFrom: 1450000,
      image: '/img/dest-weh.svg',
      gallery: ['/img/dest-weh.svg', '/img/dest-ora.svg'],
      featured: true,
      status: 'published',
      createdAt: day(28)
    },
    {
      id: db.uid('dst'),
      slug: 'pulau-misool',
      name: 'Pulau Misool',
      lat: -1.892,
      lng: 129.99,
      region: 'Raja Ampat, Papua Barat Daya',
      tagline: 'Karst ikonik, laguna tersembunyi, dan danau cinta berwarna merah muda',
      description:
        'Misool adalah jantung selatan Raja Ampat dengan formasi batu kapur dramatis yang menjulang dari laut biru toska. Kawasan konservasi ini menyimpan danau cinta, laguna tersembunyi, dan taman laut yang diakui sebagai salah satu yang terkaya di dunia.',
      highlights: [
        'Kayaking di antara karst Batu Belah',
        'Berenang di Danau Cinta berwarna merah muda',
        'Liveaboard 4 hari 3 malam menyusuri selatan Misool',
        'Snorkeling di spot Boo Window'
      ],
      bestSeason: 'Oktober – April',
      duration: '4–7 hari',
      gettingThere: 'Pesawat ke Sorong, lalu liveaboard atau speedboat ke Misool',
      facilities: ['Resor terapung', 'Liveaboard', 'Pusat konservasi'],
      priceFrom: 4200000,
      image: '/img/dest-misool.svg',
      gallery: ['/img/dest-misool.svg', '/img/dest-sabesi.svg'],
      featured: true,
      status: 'published',
      createdAt: day(26)
    },
    {
      id: db.uid('dst'),
      slug: 'pulau-derawan',
      name: 'Pulau Derawan',
      lat: 2.2833,
      lng: 118.25,
      region: 'Berau, Kalimantan Timur',
      tagline: 'Danau ubur-ubur tanpa sengat dan penyu hijau yang bertelur di pantai',
      description:
        'Derawan terkenal dengan Kakaban — danau ubur-ubur tanpa sengat, dan Sangalaki — tempat penyu sisik dan pari manta berkumpul. Airnya hangat, jernih, dan ramah untuk perenang pemula sekalipun.',
      highlights: [
        'Berenang bersama ubur-ubur di Danau Kakaban',
        'Bertemu pari manta di perairan Sangalaki',
        'Snorkeling di Blue Lake yang biru memukau',
        'Menjelajah gugusan Pulau Maratua'
      ],
      bestSeason: 'Maret – Oktober',
      duration: '4–5 hari',
      gettingThere: 'Pesawat ke Berau (BEJ), lalu speedboat ± 30 menit',
      facilities: ['Resor & homestay', ' dive center', 'Rumah makan'],
      priceFrom: 2350000,
      image: '/img/dest-derawan.svg',
      gallery: ['/img/dest-derawan.svg'],
      featured: false,
      status: 'published',
      createdAt: day(24)
    },
    {
      id: db.uid('dst'),
      slug: 'pulau-togean',
      name: 'Kepulauan Togean',
      lat: -0.3933,
      lng: 121.978,
      region: 'Tojo Una-Una, Sulawesi Tengah',
      tagline: 'Terumbu Karang Wallacea yang masih perawan di jantung Teluk Tomini',
      description:
        'Gugusan pulau di Teluk Tomini ini menyimpan taman laut dengan biodiversitas luar biasa, termasuk tiga dari tujuh spesies penyu dunia. Jauh dari keramaian, Togean menawarkan kesunyian tropis yang semakin langka.',
      highlights: [
        'Snorkeling di B24 wreck dan Danau Mariona',
        'Tiga spesies penyu dalam satu kawasan',
        'Desa Bajo dengan rumah apung tradisional',
        'Hutan hujan dengan primata endemik'
      ],
      bestSeason: 'April – November',
      duration: '5–6 hari',
      gettingThere: 'Pesawat ke Palu, lanjut bus ke Ampana, lalu kapal ke Togean',
      facilities: ['Homestay sederhana', 'Paket liveaboard', 'Warung lokal'],
      priceFrom: 2100000,
      image: '/img/dest-togean.svg',
      gallery: ['/img/dest-togean.svg'],
      featured: false,
      status: 'published',
      createdAt: day(22)
    },
    {
      id: db.uid('dst'),
      slug: 'pulau-ora',
      name: 'Pulau Ora',
      lat: -3.0733,
      lng: 129.9197,
      region: 'Seram, Maluku',
      tagline: 'Maladewa Indonesia dengan resort kayu di atas air jernih',
      description:
        'Pantai Pasir Putih Timang dan gugusan Pulau Ora di Telu Seram menawarkan pemandangan yang kerap disamakan dengan Maladewa. Air bening, pasir seputih susu, dan terumbu karang yang bisa dicapai hanya dengan berenang dari pantai.',
      highlights: [
        'Menginap di cottage kayu di atas laut',
        'Snorkeling langsung dari dermaga',
        'Sunset spektakuler di Pasir Putih',
        'Berkunjung ke goa kelelawar Belang'
      ],
      bestSeason: 'Oktober – Desember',
      duration: '4–5 hari',
      gettingThere: 'Pesawat ke Ambon, kapal cepat ke Masohi, lalu perjalanan darat + speedboat',
      facilities: ['Ora Beach Resort', 'Homestay lokal', 'Pemandu wisata'],
      priceFrom: 2750000,
      image: '/img/dest-ora.svg',
      gallery: ['/img/dest-ora.svg', '/img/dest-weh.svg'],
      featured: true,
      status: 'published',
      createdAt: day(20)
    },
    {
      id: db.uid('dst'),
      slug: 'karimunjawa',
      name: 'Karimunjawa',
      lat: -5.9211,
      lng: 110.4417,
      region: 'Jepara, Jawa Tengah',
      tagline: 'Laut jernih dengan 27 pulau kecil yang bisa dijelajahi dalam satu trip',
      description:
        'Gugusan 27 pulau di utara Jawa ini menjadi favorit pemula karena akses mudah dari Semarang/Jepara, air yang jernih, dan biaya yang bersahabat. Menara love, Hanzel island, dan laguna di pulau pamornya menawarkan spot snorkeling kelas dewasa muda.',
      highlights: [
        'Snorkeling di Menara Cinta dan Turtle point',
        'Sunset di Pantai Tanjung Gelam',
        'Hopping island ke pulau-pulau kecil',
        'Homestay & glamping tepi laut'
      ],
      bestSeason: 'April – Oktober',
      duration: '3–4 hari',
      gettingThere: 'Pesawat/bus ke Semarang atau Jepara, lalu speedboat ± 2 jam',
      facilities: ['Homestay & resort', 'Sewa kapal & alat snorkeling', 'Warung seafood'],
      priceFrom: 1250000,
      image: '/img/dest-karimunjawa.svg',
      gallery: ['/img/dest-karimunjawa.svg', '/img/dest-ora.svg'],
      featured: false,
      status: 'published',
      createdAt: day(15)
    },
    {
      id: db.uid('dst'),
      slug: 'belitung',
      name: 'Belitung',
      lat: -2.7512,
      lng: 107.6441,
      region: 'Kepulauan Bangka Belitung',
      tagline: 'Batu granit raksasa, laut dangkal bening, dan pulau laskar pelangi',
      description:
        'Terkenal lewat novel Laskar Pelangi, Belitung menyuguhkan pantai berbatu granit raksasa dengan air laut sebening kaca. Cocok untuk liburan santai keluarga, island hopping ringan, dan menikmati kuliner kerang serta kopi local.',
      highlights: [
        'Island hopping Pulau Lengkuas dengan mercusuar bersejarah',
        'Batu Hitam dan Pantai Tanjung Tinggi',
        'Kolam dan pasir pantai yang landai untuk anak',
        'Wisata kuliner & kopi Belitung'
      ],
      bestSeason: 'Maret – November',
      duration: '3–4 hari',
      gettingThere: 'Pesawat langsung ke H.A.S. Hanandjoeddin (TJB) dari Jakarta/Surabaya',
      facilities: ['Hotel bintang 4', 'Sewa mobil & boat', 'Kuliner lokal'],
      priceFrom: 1650000,
      image: '/img/dest-belitung.svg',
      gallery: ['/img/dest-belitung.svg', '/img/dest-karimunjawa.svg'],
      featured: false,
      status: 'published',
      createdAt: day(11)
    }
  ];

  const packages = [
    {
      id: db.uid('pkg'),
      slug: 'sabesi-island-escape',
      title: 'Sabesi Island Escape',
      destinationSlug: 'pulau-sabesi',
      destinationName: 'Pulau Sabesi',
      days: 4,
      nights: 3,
      price: 1850000,
      groupSize: '4–12 orang',
      summary:
        'Paket favorit untuk menikmati Sabesi tanpa terburu-buru: tiga malam di homestay desa, snorkeling empat spot unggulan, dan sesi sunset di dermaga Barat.',
      itinerary: [
        { day: 1, title: 'Tiba di Sabesi & sunset dermaga', detail: 'Penjemputan di pelabuhan Waisai, transfer speedboat, check-in homestay, sore hari menikmati sunset di dermaga Barat, malamnya makan malam ikan bakar khas desa.' },
        { day: 2, title: 'Snorkeling spot Yenbuba & mangrove', detail: 'Pagi snorkeling di Yenbuba yang kaya ikan karang, siang istirahat di desa, sore menyusuri hutan mangrove dengan perahu kecil.' },
        { day: 3, title: 'Pulau kecil & kampung bahari', detail: 'Hopping island ke pulau-pulau kecil sekitar Sabesi, makan siang di pulau pasir, sore hari interaksi dengan warga dan demo membuat sagu.' },
        { day: 4, title: 'Pagi bebas & kembali ke Waisai', detail: 'Pagi hari bebas berenang atau kamera bawah air, kemudian transfer kembali ke Waisai sesuai jadwal kapal.' }
      ],
      includes: ['Speedboat pulang-pergi Waisai–Sabesi', 'Homestay 3 malam (kamar ber-AC portable)', 'Sarapan, makan siang, makan malam', 'Pemandu lokal', 'Alat snorkeling (masker, fin, pelampung)', 'Air mineral selama trip'],
      excludes: ['Tiket pesawat ke Sorong/Waisai', 'Asuransi perjalanan', 'Pengeluaran pribadi', 'Tips pemandu (sukarela)'],
      image: '/img/dest-sabesi.svg',
      featured: true,
      status: 'published',
      createdAt: day(18)
    },
    {
      id: db.uid('pkg'),
      slug: 'misool-southern-lagoon',
      title: 'Misool Southern Lagoon Liveaboard',
      destinationSlug: 'pulau-misool',
      destinationName: 'Pulau Misool',
      days: 5,
      nights: 4,
      price: 4200000,
      groupSize: '6–10 orang',
      summary:
        'Liveaboard empat malam menyusuri selatan Misool: karst dramatis, Danau Cinta, dan spot-spot ikonik yang jarang tersentuh wisatawan massal.',
      itinerary: [
        { day: 1, title: 'Boarding & sunset cruise', detail: 'Naik liveaboard dari Waisai, briefing keselamatan, makan malam pertama di atas kapal sambil menyaksikan sunset.' },
        { day: 2, title: 'Karst dan Danau Cinta', detail: 'Kayaking di gugusan karst, snorkeling di Boo Window, sore hari menuju Danau Cinta untuk sesi foto dan berenang.' },
        { day: 3, title: 'Wayag viewpoint & blue water', detail: 'Hiking pagi ke viewpoint Wayag, snorkeling di perairan biru pekat sekitar Piaynemo kecil, makan malam tema seafood.' },
        { day: 4, title: 'Spot pilihan & freediving session', detail: 'Dua sesi snorkeling/freediving di spot terbaik menyesuaikan arus, sesi fotografi bawah air bersama pemandu.' },
        { day: 5, title: 'Kembali ke Waisai', detail: 'Sarapan di kapal, kembali ke dermaga Waisai, transfer bandara sesuai jadwal penerbangan.' }
      ],
      includes: ['Liveaboard 4 malam (kabin ber-AC)', 'Full board meals', 'Dua pemandu snorkeling profesional', 'Alat snorkeling & kayak', 'Biaya konservasi & tiket kawasan'],
      excludes: ['Tiket pesawat ke Sorong', 'Minuman beralkohol', 'Pengeluaran pribadi'],
      image: '/img/dest-misool.svg',
      featured: true,
      status: 'published',
      createdAt: day(16)
    },
    {
      id: db.uid('pkg'),
      slug: 'weh-sunset-escape',
      title: 'Weh Sunset Escape',
      destinationSlug: 'pulau-weh',
      destinationName: 'Pulau Weh',
      days: 3,
      nights: 2,
      price: 1450000,
      groupSize: '2–8 orang',
      summary:
        'Liburan singkat ke titik nol kilometer: Iboih, Rubiah, dan air panas alami — dirancang untuk akhir pekan panjang.',
      itinerary: [
        { day: 1, title: 'Tiba & Pantai Sumur Tiga', detail: 'Penjemputan bandara/ferry, check-in penginapan, sore di Pantai Sumur Tiga, makan malam seafood.' },
        { day: 2, title: 'Rubiah & Air Hangat', detail: 'Snorkeling di Pulau Rubiah pagi hari, siang menuju Air Hangat untuk berendam di kolam air panas alami, kembali sore untuk nol kilometer.' },
        { day: 3, title: 'Iboih & pulang', detail: 'Jalan-jalan santai di Iboih, beli oleh-oleh, transfer ke bandara/ferry.' }
      ],
      includes: ['Transportasi darat AC', 'Penginapan 2 malam', 'Sarapan', 'Tiket masuk objek wisata', 'Pemandu'],
      excludes: ['Tiket pesawat/kapal ke Sabang', 'Makan siang & malam', 'Alat snorkeling tambahan'],
      image: '/img/dest-weh.svg',
      featured: false,
      status: 'published',
      createdAt: day(14)
    },
    {
      id: db.uid('pkg'),
      slug: 'derawan-jellyfish-quest',
      title: 'Derawan Jellyfish Quest',
      destinationSlug: 'pulau-derawan',
      destinationName: 'Pulau Derawan',
      days: 4,
      nights: 3,
      price: 2350000,
      groupSize: '4–10 orang',
      summary:
        'Ekspedisi empat hari ke Kakaban dan Sangalaki: ubur-ubur tanpa sengat, pari manta, dan penyu hijau.',
      itinerary: [
        { day: 1, title: 'Tiba di Derawan', detail: 'Speedboat dari Berau, check-in resor, sesi snorkeling sore di house reef Derawan.' },
        { day: 2, title: 'Kakaban & Blue Lake', detail: 'Berenang di danau ubur-ubur Kakaban, lanjut ke Blue Lake untuk berenang di air biru pekat.' },
        { day: 3, title: 'Sangalaki manta & penyu', detail: 'Snorkeling bersama pari manta di Sangalaki, sore mencari penyu hijau di perairan sekitar.' },
        { day: 4, title: 'Maratua & kembali', detail: 'Pagi santai di Maratua, kembali ke Berau via speedboat.' }
      ],
      includes: ['Speedboat semua rute', 'Resor 3 malam', 'Full board', 'Tiket konservasi', 'Pemandu snorkeling'],
      excludes: ['Tiket pesawat ke Berau', 'Dive kit (tersedia sewa)'],
      image: '/img/dest-derawan.svg',
      featured: false,
      status: 'published',
      createdAt: day(12)
    },
    {
      id: db.uid('pkg'),
      slug: 'open-trip-sabesi-3h2m',
      title: 'Open Trip Sabesi 3H2M',
      destinationSlug: 'pulau-sabesi',
      destinationName: 'Pulau Sabesi',
      days: 3,
      nights: 2,
      price: 1450000,
      groupSize: '8–16 orang (open trip)',
      summary:
        'Paket open trip hemat ke Sabesi: dua malam homestay, snorkeling Yenbuba & Piaynemo kecil, plus sunset dermaga. Berangkat setiap Rabu & Sabtu.',
      itinerary: [
        { day: 1, title: 'Waisai → Sabesi', detail: 'Berkumpul di dermaga Waisai pukul 11.00, speedboat bersama rombongan, check-in homestay, sore snorkeling ringan di house reef desa.' },
        { day: 2, title: 'Snorkeling 3 spot', detail: 'Yenbuba, Arborek, dan Piaynemo kecil — pemandu lokal mendampingi sepanjang hari, makan siang di pulau pasir.' },
        { day: 3, title: 'Mangrove & kembali', detail: 'Pagi menyusuri mangrove, oleh-oleh kerupuk ikan kampung, kembali ke Waisai siang hari.' }
      ],
      includes: ['Speedboat pulang-pergi', 'Homestay 2 malam', 'Sarapan & 4x makan', 'Pemandu & alat snorkeling', 'Tiket kawasan'],
      excludes: ['Tiket pesawat ke Sorong/Waisai', 'Makan malam hari pertama', 'Pengeluaran pribadi'],
      image: '/img/dest-sabesi.svg',
      featured: false,
      status: 'published',
      createdAt: day(9)
    },
    {
      id: db.uid('pkg'),
      slug: 'togean-turtle-expedition',
      title: 'Togean Turtle Expedition',
      destinationSlug: 'pulau-togean',
      destinationName: 'Kepulauan Togean',
      days: 6,
      nights: 5,
      price: 3150000,
      groupSize: '4–8 orang',
      summary:
        'Ekspedisi enam hari ke jantung Teluk Tomini: tiga spesies penyu, bangkai kapal B24, dan homestay Bajo di atas laut.',
      itinerary: [
        { day: 1, title: 'Palu → Ampana', detail: 'Penjemputan di bandara Palu, perjalanan darat ke Ampana, menginap menunggu kapal pagi.' },
        { day: 2, title: 'Crossing ke Togean', detail: 'Kapal umum ke Togean, check-in homestay, sore santai di pantai.' },
        { day: 3, title: 'Penyu & B24 wreck', detail: 'Snorkeling di spot penyu dan bangkai kapal Perang Dunia II B24.' },
        { day: 4, title: 'Danau Mariona & Bajo', detail: 'Snorkeling danau air payau Mariona, kunjungan ke desa Bajo Mata Air.' },
        { day: 5, title: 'Hutan & primata', detail: 'Trekking ringan hutan Togean mencari monyet ekor panjang endemik.' },
        { day: 6, title: 'Kembali ke Ampana', detail: 'Kapal sore kembali ke Ampana, transfer ke Palu sesuai jadwal penerbangan.' }
      ],
      includes: ['Transportasi darat & laut', 'Homestay 5 malam', 'Full board', 'Pemandu lokal', 'Tiket kawasan'],
      excludes: ['Tiket pesawat ke Palu', 'Minuman', 'Tips pemandu'],
      image: '/img/dest-togean.svg',
      featured: false,
      status: 'published',
      createdAt: day(8)
    },
    {
      id: db.uid('pkg'),
      slug: 'ora-beach-retreat',
      title: 'Ora Beach Retreat',
      destinationSlug: 'pulau-ora',
      destinationName: 'Pulau Ora',
      days: 5,
      nights: 4,
      price: 3850000,
      groupSize: '2–8 orang',
      summary:
        'Retreat empat malam di cottage kayu di atas air bening Teluk Seram — snorkeling dari dermaga, sunset Pasir Putih, dan goa kelelawar.',
      itinerary: [
        { day: 1, title: 'Ambon → Seram', detail: 'Pesawat ke Ambon, kapal cepat ke Masohi, perjalanan darat menuju Saunulu.' },
        { day: 2, title: 'Check-in Ora Beach', detail: 'Transfer perahu ke resort, sore snorkeling house reef, makan malam seafood.' },
        { day: 3, title: 'Pasir Putih & Selaru', detail: 'Hopping ke Pantai Pasir Putih dan pulau Selaru, sesi foto bawah air.' },
        { day: 4, title: 'Goa & sunset', detail: 'Pagi Goa Kelelawar Belang, sore santai & sunset dari dermaga resort.' },
        { day: 5, title: 'Kembali ke Ambon', detail: 'Kapal pagi ke Masohi, lanjut ke Ambon untuk penerbangan pulang.' }
      ],
      includes: ['Resort 4 malam full board', 'Transportasi darat & laut', 'Pemandu wisata', 'Sewa kayak'],
      excludes: ['Tiket pesawat ke Ambon', 'Minuman beralkohol'],
      image: '/img/dest-ora.svg',
      featured: false,
      status: 'published',
      createdAt: day(7)
    },
    {
      id: db.uid('pkg'),
      slug: 'karimunjawa-sailing-4h3m',
      title: 'Karimunjawa Sailing 4H3M',
      destinationSlug: 'karimunjawa',
      destinationName: 'Karimunjawa',
      days: 4,
      nights: 3,
      price: 1750000,
      groupSize: '6–14 orang',
      summary:
        'Sailing trip pulau-pulau Karimunjawa: Menara Cinta, Hanzel Island, Turtle point, dan sunset Tanjung Gelam.',
      itinerary: [
        { day: 1, title: 'Tiba di Karimunjawa', detail: 'Penjemputan pelabuhan, check-in penginapan, sore bebas di pantai desa.' },
        { day: 2, title: 'Snorkeling 5 spot', detail: 'Menara Cinta, Turtle point, Tanjung Gelam, Lele, dan Gosong — full day dengan kapal kayu tradisional.' },
        { day: 3, title: 'Hanzel & sunset', detail: 'Pagi ke Hanzel Island dan Coconut island, sore sunset di Tanjung Gelam, malam barbecue ikan.' },
        { day: 4, title: 'Pulang', detail: 'Pagi beli oleh-oleh, kapal ke Jepara/Semarang sesuai jadwal.' }
      ],
      includes: ['Kapal snorkeling 2 hari', 'Penginapan 3 malam', 'Sarapan', 'Alat snorkeling', 'Tiket taman nasional'],
      excludes: ['Transportasi ke Jepara', 'Makan siang & malam'],
      image: '/img/dest-karimunjawa.svg',
      featured: true,
      status: 'published',
      createdAt: day(6)
    },
    {
      id: db.uid('pkg'),
      slug: 'belitung-island-hopping-3h2m',
      title: 'Belitung Island Hopping 3H2M',
      destinationSlug: 'belitung',
      destinationName: 'Belitung',
      days: 3,
      nights: 2,
      price: 1250000,
      groupSize: '2–10 orang',
      summary:
        'Trip singkat santai ke Batu Hitam, Pulau Lengkuas, dan Tanjung Tinggi — cocok untuk keluarga dan first trip bahari.',
      itinerary: [
        { day: 1, title: 'Tiba & city tour', detail: 'Penjemputan bandara, tour kota & Museum Kata Andrea Hirata, makan malam kerang.' },
        { day: 2, title: 'Island hopping', detail: 'Pulau Lengkuas (mercusuar), Batu Berlayar, Pasir Padi — makan siang di kapal.' },
        { day: 3, title: 'Tanjung Tinggi & pulang', detail: 'Pagi di Tanjung Tinggi bermain batu granit raksasa, transfer bandara.' }
      ],
      includes: ['Sewa kapal 2 hari', 'Hotel 2 malam', 'Sarapan', 'Tiket masuk', 'Guide lokal'],
      excludes: ['Tiket pesawat', 'Makan siang & malam'],
      image: '/img/dest-belitung.svg',
      featured: false,
      status: 'published',
      createdAt: day(5)
    }
  ];

  const articles = [
    {
      id: db.uid('art'),
      slug: '7-tips-snorkeling-pertama-kali',
      title: '7 Tips Snorkeling Pertama Kali di Perairan Tropis',
      excerpt: 'Baru pertama kali snorkeling? Simak persiapan dan teknik dasar agar pengalaman pertama kamu nyaman dan aman.',
      body:
        'Snorkeling adalah cara paling mudah menikmati keindahan bawah laut tanpa sertifikasi menyelam. Namun ada beberapa hal yang perlu disiapkan agar pengalaman pertama kamu berjalan lancar.\n\n## 1. Pilih waktu dengan air tenang\nSebagian besar spot wisata pulau memiliki arus terkuat saat pergantian pasang. Tanyakan jam terbaik ke pemandu — biasanya pagi hari antara pukul 07.00–10.00.\n\n## 2. Gunakan masker yang pas\nMasker yang bocor akan mengalihkan seluruh perhatian kamu. Tekan masker ke wajah tanpa tali, lalu hisap — jika menempel beberapa detik, ukurannya pas.\n\n## 3. Bernapas lewat mulut\nTubuh jauh lebih rileks ketika kamu bernapas lewat mulut sambil menghadap ke air. Latihan di kolam renang dulu sangat membantu.\n\n## 4. Jangan menyentuh karang\nKarang hidup sangat rapuh. Sentuhan sekecil apa pun bisa memutus puluhan tahun pertumbuhannya. Jaga jarak minimal satu meter.\n\n## 5. Pakai pelampungMeskipun kamu perenang yang baik, arus bisa berubah. Pelampung memberi rasa aman tanpa mengurangi kesenangan.\n\n## 6. Olesi sunscreen ramah karang\nSunscreen konvensional mengandung bahan yang memutihkan karang. Gunakan sunscreen mineral atau baju renang berlengan panjang.\n\n## 7. Istirahat jika lelah\nSungai tenang pun melelahkan. Beristirahatlah di perahu setiap 30–45 menit dan minum air yang cukup.',
      category: 'Tips Wisata',
      author: `Tim ${BRAND.display}`,
      coverImage: '/img/dest-sabesi.svg',
      status: 'published',
      publishedAt: day(10)
    },
    {
      id: db.uid('art'),
      slug: 'musim-terbaik-kunjungi-raja-ampat',
      title: 'Musim Terbaik Berkunjung ke Raja Ampat dan Sabesi',
      excerpt: 'Raja Ampat punya dua musim yang menentukan kualitas perjalananmu. Kenali perbedaannya sebelum memesan tiket.',
      body:
        'Raja Ampat, termasuk Pulau Sabesi, memiliki dua musim yang cukup jelas. Memilih waktu yang tepat akan membuat perjalanan jauh lebih nyaman.\n\n## Oktober – April: musim barat\nOmbak lebih tenang, visibility bawah laut terbaik, dan langit cerah di pagi hari. Ini adalah puncak musim wisata, jadi pesan homestay jauh-jauh hari.\n\n## Mei – September: musim timur\nAngin kering membuat laut lebih bergelombang di sisi selatan, namun sisi utara tetap nyaman. Keuntungannya: lebih sedikit wisatawan dan harga lebih ramah.\n\n## Perkiraan biaya\nPaket 4 hari 3 malam ke Sabesi berkisar 1,8–2,5 juta rupiah per orang sudah termasuk homestay, makan, dan pemandu — belum termasuk tiket pesawat.\n\n## Kesimpulan\nJika kamu mengejar visibilitas terbaik untuk snorkeling, pilih Januari–Maret. Jika menginginkan ketenangan dan harga hemat, pilih Juni–Agustus.',
      category: 'Panduan Musim',
      author: 'Rani Prameswari',
      coverImage: '/img/dest-misool.svg',
      status: 'published',
      publishedAt: day(8)
    },
    {
      id: db.uid('art'),
      slug: 'wisata-bahari-ramah-lingkungan',
      title: 'Prinsip Wisata Bahari Ramah Lingkungan yang Kita Terapkan',
      excerpt: `Setiap perjalanan bersama ${BRAND.display} menerapkan prinsip konservasi sederhana yang berdampak besar bagi pulau.`,
      body:
        'Pulau kecil adalah ekosistem yang rapuh. Satu kali kedatangan wisatawan yang tidak bertanggung jawab bisa merusak karang yang tumbuh puluhan tahun.\n\n## Tidak membuang sampah di laut\nSemua sampah dibawa kembali ke daratan dan dipilah bersama warga desa mitra.\n\n## Homestay milik warga\nSebagian besar pendapatan mengalir langsung ke keluarga lokal sehingga mereka memiliki insentif langsung untuk menjaga laut.\n\n## Batasi jumlah rombongan\nKami membatasi maksimal 12 orang per kelompok agar tekanan terhadap spot snorkeling tetap rendah.\n\n## Edukasi sebelum turun air\nSetiap peserta mendapat briefing singkat tentang karang, ikan hias, dan cara menjaga jarak.',
      category: 'Konservasi',
      author: 'Dimas Ardhana',
      coverImage: '/img/dest-ora.svg',
      status: 'published',
      publishedAt: day(6)
    },
    {
      id: db.uid('art'),
      slug: 'kemasan-ringan-liburan-pulau',
      title: 'Kemasan Ringan untuk Liburan Pulau: Checklist Lengkap',
      excerpt: 'Satu tas 40 liter cukup untuk empat hari di pulau. Berikut daftar yang sudah kami uji bertahun-tahun.',
      body:
        'Liburan pulau tidak membutuhkan koper besar. Kuncinya adalah pakaian cepat kering dan perlindungan dari matahari.\n\n## Pakaian\nTiga set pakaian cepat kering, satu jaket tipis untuk malam, satu set pakaian sopan untuk berkunjung ke desa.\n\n## Perlindungan matahari\nKacamata hitam, topi lebar, sunscreen mineral, dan rash guard berlengan panjang.\n\n## Elektronik\nPowerbank 20.000 mAh, kabel tahan air, dan dry bag 10 liter untuk perahu.\n\n## Obat pribadi\nAntiseptik luka, obat anti mabuk laut, dan obat alergi. Sengatan ubur-ubur jarang serius tetapi tetap perlu diantisipasi.',
      category: 'Persiapan',
      author: `Tim ${BRAND.display}`,
      coverImage: '/img/dest-togean.svg',
      status: 'published',
      publishedAt: day(4)
    }
  ];

  const bookings = [
    {
      id: db.uid('bkg'),
      code: 'SYLT-240501',
      name: 'Ayu Lestari',
      email: 'ayu.lestari@example.com',
      phone: '081234567890',
      packageSlug: 'sabesi-island-escape',
      packageName: 'Sabesi Island Escape',
      departureDate: '2026-11-12',
      participants: 2,
      notes: 'Ingin kamar menghadap laut jika tersedia.',
      status: 'confirmed',
      customerId: null,
      packagePrice: 1850000,
      totalAmount: 3700000,
      paymentMethod: 'manual',
      paymentStatus: 'paid',
      proofImage: null,
      paidAt: day(3),
      checkIn: null,
      track: [],
      createdAt: day(5)
    },
    {
      id: db.uid('bkg'),
      code: 'SYLT-240502',
      name: 'Bima Saputra',
      email: 'bima.s@example.com',
      phone: '085678901234',
      packageSlug: 'misool-southern-lagoon',
      packageName: 'Misool Southern Lagoon Liveaboard',
      departureDate: '2026-12-03',
      participants: 4,
      notes: 'Satu peserta vegetarian.',
      status: 'pending',
      customerId: null,
      packagePrice: 4200000,
      totalAmount: 16800000,
      paymentMethod: null,
      paymentStatus: 'unpaid',
      proofImage: null,
      paidAt: null,
      checkIn: null,
      track: [],
      createdAt: day(3)
    },
    {
      id: db.uid('bkg'),
      code: 'SYLT-240503',
      name: 'Citra Ayuning',
      email: 'citra.ayu@example.com',
      phone: '087812345678',
      packageSlug: 'weh-sunset-escape',
      packageName: 'Weh Sunset Escape',
      departureDate: '2026-10-28',
      participants: 3,
      notes: '',
      status: 'pending',
      customerId: null,
      packagePrice: 1450000,
      totalAmount: 4350000,
      paymentMethod: null,
      paymentStatus: 'unpaid',
      proofImage: null,
      paidAt: null,
      checkIn: null,
      track: [],
      createdAt: day(1)
    },
    {
      id: db.uid('bkg'),
      code: 'SYLT-240418',
      name: 'Rangga Saputra',
      email: 'rangga@example.com',
      phone: '085678901234',
      packageSlug: 'derawan-jellyfish-quest',
      packageName: 'Derawan Jellyfish Quest',
      departureDate: '2026-09-18',
      participants: 2,
      notes: 'Honeymoon — minta kamar dekat dermaga.',
      status: 'completed',
      customerId: null,
      packagePrice: 2350000,
      totalAmount: 4700000,
      paymentMethod: 'manual',
      paymentStatus: 'paid',
      proofImage: null,
      paidAt: day(28),
      checkIn: { lat: 2.2989, lng: 118.2412, at: day(20) },
      track: [
        { lat: 2.2989, lng: 118.2412, label: 'Dermaga Derawan' },
        { lat: 2.2602, lng: 118.3124, label: 'Kakaban Lake' },
        { lat: 2.1971, lng: 118.2018, label: 'Sangalaki Manta Point' }
      ],
      createdAt: day(32)
    },
    {
      id: db.uid('bkg'),
      code: 'SYLT-240504',
      name: 'Ayu Lestari',
      email: 'ayu.lestari@example.com',
      phone: '081234567890',
      packageSlug: 'weh-sunset-escape',
      packageName: 'Weh Sunset Escape',
      departureDate: '2026-11-28',
      participants: 2,
      notes: 'Anniversary — dekorasi kamar jika bisa.',
      status: 'confirmed',
      customerId: null,
      packagePrice: 1450000,
      totalAmount: 2900000,
      paymentMethod: 'manual',
      paymentStatus: 'pending',
      proofImage: null,
      paidAt: null,
      checkIn: null,
      track: [],
      createdAt: day(2)
    },
    {
      id: db.uid('bkg'),
      code: 'SYLT-240505',
      name: 'Hendra Wijaya',
      email: 'hendra.w@example.com',
      phone: '081377778888',
      packageSlug: 'karimunjawa-sailing-4h3m',
      packageName: 'Karimunjawa Sailing 4H3M',
      departureDate: '2026-12-20',
      participants: 6,
      notes: 'Rombongan kantor, minta invoice perusahaan.',
      status: 'pending',
      customerId: null,
      packagePrice: 1750000,
      totalAmount: 10500000,
      paymentMethod: null,
      paymentStatus: 'unpaid',
      proofImage: null,
      paidAt: null,
      checkIn: null,
      track: [],
      createdAt: day(1)
    }
  ];

  const customers = [
    {
      id: db.uid('cus'),
      name: 'Ayu Lestari',
      email: 'ayu.lestari@example.com',
      phone: '081234567890',
      passwordHash: bcrypt.hashSync('customer123', 10),
      createdAt: day(5)
    },
    {
      id: db.uid('cus'),
      name: 'Rangga Saputra',
      email: 'rangga@example.com',
      phone: '085678901234',
      passwordHash: bcrypt.hashSync('customer123', 10),
      createdAt: day(2)
    }
  ];

  // Tautkan booking ke akun pelanggan demo berdasarkan email (robust
  // terhadap penambahan/urutan booking baru di seed).
  bookings.forEach((b) => {
    const owner = customers.find((c) => c.email === b.email);
    if (owner) b.customerId = owner.id;
  });

  const reviews = [
    {
      id: db.uid('rev'),
      bookingCode: 'SYLT-238122',
      customerName: 'Nadia Kusuma',
      packageName: 'Sabesi Island Escape',
      rating: 5,
      comment:
        'Pemandunya luar biasa! Spot snorkeling di Sabesi jernih banget dan homestay warganya nyaman. Timing berangkatnya tepat, tidak ada drama.',
      status: 'approved',
      createdAt: day(12)
    },
    {
      id: db.uid('rev'),
      bookingCode: 'SYLT-238099',
      customerName: 'Fajar Nugroho',
      packageName: 'Weh Sunset Escape',
      rating: 4,
      comment:
        'Sunset di Iboih juara. Itinerary santai tapi tidak membosankan. Hanya saja kapal sore agak penuh, next time minta rombongan kecil.',
      status: 'approved',
      createdAt: day(9)
    },
    {
      id: db.uid('rev'),
      bookingCode: 'SYLT-240502',
      customerName: 'Bima Saputra',
      packageName: 'Misool Southern Lagoon Liveaboard',
      rating: 5,
      comment: 'Liveaboard-nya top! Kantor kami sudah request repeat tahun depan.',
      status: 'pending',
      createdAt: day(1)
    },
    {
      id: db.uid('rev'),
      bookingCode: 'SYLT-240418',
      customerName: 'Rangga Saputra',
      packageName: 'Derawan Jellyfish Quest',
      rating: 5,
      comment:
        'Berenang bareng ubur-ubur di Kakaban itu pengalaman seumur hidup. Check-in GPS di akun pelanggannya juga keren — waypoint perjalanan kami tersimpan rapi di peta.',
      status: 'approved',
      createdAt: day(18)
    },
    {
      id: db.uid('rev'),
      bookingCode: 'SYLT-240311',
      customerName: 'Maya Putri',
      packageName: 'Misool Southern Lagoon Liveaboard',
      rating: 5,
      comment:
        'Fasilitator liveaboard profesional, makanannya enak-enak, dan spot morning star pas banget buat yang baru belajar snorkeling.',
      status: 'approved',
      createdAt: day(15)
    },
    {
      id: db.uid('rev'),
      bookingCode: 'SYLT-240221',
      customerName: 'Yoga Pratama',
      packageName: 'Weh Sunset Escape',
      rating: 4,
      comment: 'Sunset Sumur Tiga memang juara. Trip singkat tapi memorable. Thanks ' + BRAND.display + '!',
      status: 'approved',
      createdAt: day(13)
    }
  ];

  const messages = [
    {
      id: db.uid('msg'),
      name: 'Fajar Nugroho',
      email: 'fajar.nugroho@example.com',
      phone: '081399887766',
      subject: 'Pertanyaan private trip Sabesi',
      message: 'Halo, kami berencana 6 orang pada Desember. Apakah bisa private trip tanpa campur rombongan lain? Berapa kisaran harganya?',
      read: false,
      createdAt: day(2)
    },
    {
      id: db.uid('msg'),
      name: 'Nadia Rahman',
      email: 'nadia.rahman@example.com',
      phone: '082155667788',
      subject: 'Kolaborasi konten',
      message: 'Saya content creator travel dengan 120k followers. Tertarik berkolaborasi untuk trip ke Pulau Sabesi bulan depan. Bisa didiskusikan?',
      read: true,
      createdAt: day(1)
    },
    {
      id: db.uid('msg'),
      name: 'Sinta Dewi',
      email: 'sinta.dewi@example.com',
      phone: '085211223344',
      subject: 'Honeymoon package Ora',
      message: 'Kami berdua ingin honeymoon ke Pulau Ora bulan Februari. Apakah ada paket privat dengan dekorasi kamar? Terima kasih!',
      read: false,
      createdAt: day(1)
    }
  ];

  const users = [
    {
      id: db.uid('usr'),
      username: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10),
      name: `Administrator ${BRAND.display}`,
      role: 'admin',
      createdAt: day(40)
    }
  ];

  const settings = {
    siteName: BRAND.display,
    tagline: 'Liburan pulau yang enak, terencana, tanpa ribet',
    whatsapp: '6281234567890',
    email: BRAND.contact.email,
    phone: '0812-3456-7890',
    address: 'Jl. Samudra Raya No. 21, Banda Aceh, Indonesia',
    instagram: BRAND.social.instagram,
    facebook: BRAND.social.facebook,
    about:
      `${BRAND.about}`,
    heroTitle: 'Pulau-pulau Indonesia,\ndibuat enak dikunjungi.',
    heroSubtitle:
      'Dari Sabesi hingga Ora — kami susun perjalanan bahari yang nyaman, aman, dan mendukung warga lokal.'
    ,
    heroImageUrl: '',
    // Pembayaran
    paymentBank: 'BCA',
    paymentAccount: '1234567890',
    paymentAccountName: BRAND.company,
    midtransServerKey: '',
    midtransClientKey: '',
    midtransProduction: false,
    tripayMerchantCode: '',
    tripayPrivateKey: '',
    tripayApiKey: '',
    tripayProduction: false,
    // WhatsApp (marketing) — provider: cloud (Meta) atau web (scan QR)
    waProvider: 'cloud',
    waToken: '',
    waPhoneId: '',
    waDefaultTemplate:
      'Halo {{nama}}! 👋 Ada trip baru ke Pulau Sabesi — Raja Ampat yang lagi promo. Mau lihat itinerary-nya? Balas pesan ini ya, kak! 🏝️',
    // Menu WhatsApp mengambang (situs publik)
    waFloatEnabled: true,
    waFloatMessage:
      `Halo ${BRAND.domain}! Saya mau tanya-tanya soal trip ya. Boleh minta info itinerary & harga?`,
    // SEO
    siteUrl: '',
    seoDescription:
      BRAND.seoDescription,
    ogImageUrl: '',
    seoIndex: true
  };

  const contacts = [
    {
      id: db.uid('ctc'),
      name: 'Maya Putri',
      phone: '62812345001',
      email: 'maya@example.com',
      source: 'booking',
      optIn: true,
      optOut: false,
      createdAt: day(20)
    },
    {
      id: db.uid('ctc'),
      name: 'Rangga Saputra',
      phone: '6285678901234',
      email: 'rangga@example.com',
      source: 'booking',
      optIn: true,
      optOut: false,
      createdAt: day(18)
    },
    {
      id: db.uid('ctc'),
      name: 'Hendra Wijaya',
      phone: '6281377778888',
      email: 'hendra.w@example.com',
      source: 'booking',
      optIn: true,
      optOut: false,
    },
    {
      id: db.uid('ctc'),
      name: 'Dimas Arga',
      phone: '08123450002',
      email: 'dimas@example.com',
      source: 'kontak',
      optIn: false,
      optOut: false,
      createdAt: day(10)
    }
  ];

  return { users, destinations, packages, articles, bookings, messages, contacts, customers, reviews, broadcasts: [], settings, version: 1 };
}

function ensureSeed() {
  const data = db.initIfEmpty(buildSeed);
  // Database lama: lengkapi field settings baru tanpa menghapus yang ada.
  const fresh = buildSeed().settings;
  // `data.settings` bisa belum ada pada db.json versi lama / rusak.
  const settings = data.settings || (data.settings = {});
  let changed = false;
  Object.keys(fresh).forEach((key) => {
    if (!(key in settings)) {
      settings[key] = fresh[key];
      changed = true;
    }
  });
  if (changed) db.write();
  return data;
}

if (require.main === module) {
  /* Seed ulang menghapus SELURUH isi database (booking, pelanggan, pesan).
     Karena itu wajib eksplisit: tanpa --force, perintah hanya menampilkan
     ringkasan dan berhenti. Backup otomatis dibuat sebelum ditulis. */
  const FORCE = process.argv.includes('--force');
  if (!FORCE) {
    const existing = db.read() || {};
    const counts = Object.entries({
      booking: (existing.bookings || []).length,
      pelanggan: (existing.customers || []).length,
      pesan: (existing.messages || []).length,
      kontak: (existing.contacts || []).length
    })
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    console.log('⚠️  Seed ulang akan MENGHAPUS seluruh isi database.');
    console.log(`   Database saat ini: ${counts}`);
    console.log('   Jalankan ulang dengan --force jika benar-benar ingin melakukan ini:');
    console.log('     npm run seed:force');
    process.exit(1);
  }

  // Backup sebelum dihapus.
  try {
    if (fs.existsSync(db.DB_FILE)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backup = path.join(path.dirname(db.DB_FILE), `db.backup-${stamp}.json`);
      fs.copyFileSync(db.DB_FILE, backup);
      console.log('💾 Backup dibuat:', path.relative(path.join(__dirname, '..'), backup));
    }
  } catch (err) {
    console.error('⚠️  Gagal membuat backup:', err.message);
    process.exit(1);
  }

  db.reset(buildSeed());
  console.log('Database berhasil di-seed ulang:', db.DB_FILE);
}

module.exports = { buildSeed, ensureSeed };