'use strict';

/**
 * Tabel admin responsif.
 *
 * Pada layar kecil (max 640px) tabel berubah menjadi kartu bertumpuk.
 * Agar informasinya tetap jelas, setiap <td> diberi label kolom yang diambil
 * otomatis dari <th> pada header tabel — sehingga tidak perlu menulis
 * data-label satu per satu di tiap template.
 */
(function () {
  /** Pasang label kolom pada sel setiap baris. */
  function labelRows(table) {
    const headRow = table.querySelector('thead tr');
    if (!headRow) return;
    const headers = Array.from(headRow.querySelectorAll('th')).map((th) =>
      (th.textContent || '').trim()
    );
    if (!headers.length) return;

    table.querySelectorAll('tbody tr').forEach((row) => {
      const cells = Array.from(row.children).filter((c) => c.tagName === 'TD');
      cells.forEach((cell, index) => {
        // Sel yang mengambil beberapa kolom sekaligus (colspan) tidak diberi label.
        if (cell.colSpan > 1) {
          cell.removeAttribute('data-label');
          cell.classList.remove('actions-cell');
          return;
        }
        const label = headers[index] || '';
        if (label) cell.setAttribute('data-label', label);
        // Kolom terakhir biasanya berisi tombol aksi.
        if (index === cells.length - 1) cell.classList.add('actions-cell');
      });
    });
  }

  function initAll() {
    document.querySelectorAll('table.a-table').forEach(labelRows);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }
})();
