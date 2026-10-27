'use strict';
/**
 * upload.js — pengalaman unggah gambar yang baik di sisi klien.
 *
 * Untuk setiap <input type="file" data-upload> di halaman:
 *   1. Validasi SEBELUM submit — tipe gambar & ukuran maksimum (5 MB).
 *   2. Preview thumbnail langsung setelah berkas dipilih.
 *   3. Pesan error yang jelas (bukan hanya "tidak valid").
 *   4. Indikator loading pada tombol submit saat berkas dikirim.
 *   5. Submit diblokir bila berkas tidak valid.
 *
 * Validasi ini PELINDUNG KESAN, bukan pengganti — server memvalidasi ulang
 * (ekstensi, MIME, magic byte, ukuran). Lihat src/multer.js.
 *
 * Progressive enhancement: tanpa JS, form tetap terkirim normal dan validasi
 * server tetap berjalan.
 */
(function () {
  var MAX_SIZE = 5 * 1024 * 1024; // 5 MB — sama dengan batas server
  var ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
  var EXT_ALLOWED = /\.(jpe?g|png|webp|gif)$/i;

  function humanSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function toast(message, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'error');
    }
  }

  /** Bangun (sekali) wadah preview + pesan error di bawah input. */
  function ensureBox(input) {
    if (input._uploadBox) return input._uploadBox;
    var box = document.createElement('div');
    box.className = 'upload-box';

    var meta = document.createElement('p');
    meta.className = 'upload-meta';
    meta.hidden = true;

    var preview = document.createElement('div');
    preview.className = 'upload-preview';
    preview.hidden = true;

    var img = document.createElement('img');
    img.alt = 'Pratinjau gambar yang akan diunggah';
    preview.appendChild(img);

    var error = document.createElement('p');
    error.className = 'upload-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    box.appendChild(preview);
    box.appendChild(meta);
    box.appendChild(error);

    if (input.parentNode) input.parentNode.insertBefore(box, input.nextSibling);
    input._uploadBox = box;
    input._uploadImg = img;
    input._uploadMeta = meta;
    input._uploadError = error;
    input._uploadPreview = preview;
    return box;
  }

  function setError(input, message) {
    var box = ensureBox(input);
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
    input._uploadError.textContent = message;
    input._uploadError.hidden = false;
    input._uploadPreview.hidden = true;
    input._uploadMeta.hidden = true;
  }

  function clearError(input) {
    ensureBox(input);
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
    input._uploadError.textContent = '';
    input._uploadError.hidden = true;
  }

  function showPreview(input, file) {
    var box = ensureBox(input);
    if (input._objectUrl) URL.revokeObjectURL(input._objectUrl);
    var url = URL.createObjectURL(file);
    input._objectUrl = url;
    input._uploadImg.src = url;
    input._uploadPreview.hidden = false;
    input._uploadMeta.textContent = file.name + ' · ' + humanSize(file.size);
    input._uploadMeta.hidden = false;
  }

  function validate(input) {
    var file = input.files && input.files[0];
    if (!file) {
      clearError(input);
      input._uploadPreview.hidden = true;
      input._uploadMeta.hidden = true;
      return true;
    }

    var typeOk = ALLOWED.indexOf((file.type || '').toLowerCase()) >= 0;
    var extOk = EXT_ALLOWED.test(file.name || '');
    if (!typeOk && !extOk) {
      setError(input, 'Format file harus JPG, PNG, WEBP, atau GIF.');
      return false;
    }
    if (file.size > MAX_SIZE) {
      setError(input, 'Ukuran gambar maksimal 5 MB (file Anda ' + humanSize(file.size) + ').');
      return false;
    }
    clearError(input);
    showPreview(input, file);
    return true;
  }

  function init() {
    var inputs = document.querySelectorAll('input[type="file"][data-upload]');
    if (!inputs.length) return;

    Array.prototype.forEach.call(inputs, function (input) {
      ensureBox(input);
      input.addEventListener('change', function () {
        validate(input);
      });
    });

    // Validasi + status loading saat form dikirim.
    Array.prototype.forEach.call(document.querySelectorAll('form'), function (form) {
      if (!form.querySelector('input[type="file"][data-upload]')) return;

      form.addEventListener('submit', function (event) {
        var fileInputs = form.querySelectorAll('input[type="file"][data-upload]');
        var firstInvalid = null;
        var hasFile = false;

        Array.prototype.forEach.call(fileInputs, function (input) {
          var file = input.files && input.files[0];
          if (file) hasFile = true;
          if (!validate(input) && !firstInvalid) firstInvalid = input;
        });

        if (firstInvalid) {
          event.preventDefault();
          toast(firstInvalid._uploadError.textContent || 'Berkas tidak valid.', 'error');
          if (firstInvalid.focus) firstInvalid.focus();
          return;
        }

        if (!hasFile) return; // tidak ada berkas → tidak perlu status loading

        // Status loading: tombol dinonaktifkan & diberi label "Mengunggah…".
        form.classList.add('is-uploading');
        var buttons = form.querySelectorAll('button[type="submit"]');
        Array.prototype.forEach.call(buttons, function (btn) {
          btn.disabled = true;
          btn.classList.add('is-loading');
          if (!btn._uploadLabel) btn._uploadLabel = btn.textContent;
          btn.textContent = 'Mengunggah…';
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
