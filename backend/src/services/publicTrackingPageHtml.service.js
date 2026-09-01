"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicTrackingErrorMessage = publicTrackingErrorMessage;
exports.buildSeguimientoWidgetScript = buildSeguimientoWidgetScript;
exports.buildTiendaNubeInlinePageContent = buildTiendaNubeInlinePageContent;
exports.buildPublicTrackingFullPageHtml = buildPublicTrackingFullPageHtml;
const PLACEHOLDER_CODE = 'LHE00100001';
function escHtml(s) {
    return String(s !== null && s !== void 0 ? s : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatDateAr(iso) {
    if (!iso)
        return '';
    try {
        return new Date(iso).toLocaleString('es-AR');
    }
    catch (_a) {
        return '';
    }
}
/** Mensaje amigable para errores genéricos (como en el diseño de referencia). */
function publicTrackingErrorMessage(raw) {
    if (!raw)
        return null;
    const msg = String(raw).trim();
    if (!msg)
        return null;
    if (msg === 'No encontramos ese código de seguimiento' ||
        msg === 'Código de seguimiento inválido' ||
        msg === 'Ingresá un código de seguimiento') {
        return msg;
    }
    return 'No pudimos consultar el seguimiento. Intentá de nuevo en unos minutos.';
}
function trackingFormStyles() {
    return `
    .lh-track-wrap { max-width: 560px; margin: 0 auto; padding: 24px 16px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; }
    .lh-track-card { background: #fff; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.08); padding: 32px 28px 28px; }
    .lh-track-intro { margin: 0 0 28px; text-align: center; font-size: 15px; line-height: 1.55; color: #333; }
    .lh-track-label { display: block; margin: 0 0 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #9ca3af; text-align: center; }
    .lh-track-input { width: 100%; padding: 16px 14px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 20px; font-weight: 700; text-align: center; letter-spacing: 0.06em; color: #111; background: #fff; outline: none; }
    .lh-track-input:focus { border-color: #111; }
    .lh-track-hint { margin: 10px 0 0; text-align: center; font-size: 12px; color: #9ca3af; line-height: 1.4; }
    .lh-track-btn { margin-top: 22px; width: 100%; padding: 16px; border: 0; border-radius: 8px; background: #111; color: #fff; font-size: 13px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }
    .lh-track-btn:hover { background: #000; }
    .lh-track-error { display: flex; align-items: flex-start; gap: 10px; max-width: 560px; margin: 16px auto 0; padding: 14px 16px; border: 1px solid #f87171; border-radius: 8px; background: #fef2f2; color: #dc2626; font-size: 13px; line-height: 1.45; }
    .lh-track-error-icon { flex-shrink: 0; width: 18px; height: 18px; border: 1.5px solid #dc2626; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; margin-top: 1px; }
    .lh-track-result { margin-top: 28px; padding-top: 24px; border-top: 1px solid #f1f5f9; }
    .lh-track-status { display: inline-block; padding: 5px 12px; border-radius: 999px; background: #f3f4f6; color: #111; font-size: 12px; font-weight: 800; letter-spacing: 0.04em; }
    .lh-track-code { margin: 12px 0 6px; font-size: 22px; font-weight: 800; letter-spacing: 0.08em; text-align: center; }
    .lh-track-meta { margin: 0; text-align: center; font-size: 13px; color: #6b7280; }
    .lh-track-timeline { list-style: none; margin: 20px 0 0; padding: 0; }
    .lh-track-timeline li { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
    .lh-track-timeline li.pending { color: #9ca3af; }
    .lh-track-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; background: #d1d5db; flex-shrink: 0; }
    .lh-track-timeline li.done .lh-track-dot { background: #111; }
  `;
}
function renderTrackingFormFields(opts) {
    const codeValue = escHtml((opts.code || '').trim().toUpperCase());
    if (opts.inline) {
        return `
    <p style="margin:0 0 28px;text-align:center;font-size:15px;line-height:1.55;color:#333;">
      Ingresá tu código de seguimiento para conocer el estado de tu envío express.
    </p>
    <form method="get" action="${escHtml(opts.action)}" style="margin:0;">
      <label style="display:block;margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;text-align:center;">
        Código de seguimiento
      </label>
      <input
        type="text"
        name="code"
        value="${codeValue}"
        required
        placeholder="${PLACEHOLDER_CODE}"
        autocomplete="off"
        style="width:100%;padding:16px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:20px;font-weight:700;text-align:center;letter-spacing:0.06em;color:#111;background:#fff;"
      />
      <p style="margin:10px 0 0;text-align:center;font-size:12px;color:#9ca3af;line-height:1.4;">
        El código figura en el mail de confirmación de envío.
      </p>
      <button type="submit" style="margin-top:22px;width:100%;padding:16px;border:0;border-radius:8px;background:#111;color:#fff;font-size:13px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;cursor:pointer;">
        Consultar
      </button>
    </form>`;
    }
    return `
    <p class="lh-track-intro">
      Ingresá tu código de seguimiento para conocer el estado de tu envío express.
    </p>
    <form method="get" action="${escHtml(opts.action)}">
      <label class="lh-track-label">Código de seguimiento</label>
      <input
        class="lh-track-input"
        type="text"
        name="code"
        value="${codeValue}"
        required
        placeholder="${PLACEHOLDER_CODE}"
        autocomplete="off"
      />
      <p class="lh-track-hint">El código figura en el mail de confirmación de envío.</p>
      <button type="submit" class="lh-track-btn">Consultar</button>
    </form>`;
}
function renderErrorBlock(message, inline) {
    const friendly = publicTrackingErrorMessage(message) || message;
    if (inline) {
        return `<div style="display:flex;align-items:flex-start;gap:10px;max-width:560px;margin:16px auto 0;padding:14px 16px;border:1px solid #f87171;border-radius:8px;background:#fef2f2;color:#dc2626;font-size:13px;line-height:1.45;">
      <span style="flex-shrink:0;width:18px;height:18px;border:1.5px solid #dc2626;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;">!</span>
      <span>${escHtml(friendly)}</span>
    </div>`;
    }
    return `<div class="lh-track-error">
    <span class="lh-track-error-icon">!</span>
    <span>${escHtml(friendly)}</span>
  </div>`;
}
function renderResultBlock(data, inline) {
    const events = (data.events || [])
        .map((ev) => {
        const at = ev.at
            ? `<br/><span style="color:#9ca3af;font-size:12px;">${escHtml(formatDateAr(ev.at))}</span>`
            : '';
        const cls = ev.done ? 'done' : 'pending';
        if (inline) {
            return `<li style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:${ev.done ? '#111' : '#9ca3af'};">
          <span style="width:10px;height:10px;border-radius:50%;margin-top:4px;background:${ev.done ? '#111' : '#d1d5db'};flex-shrink:0;"></span>
          <span><strong>${escHtml(ev.label)}</strong>${at}</span>
        </li>`;
        }
        return `<li class="${cls}"><span class="lh-track-dot"></span><span><strong>${escHtml(ev.label)}</strong>${at}</span></li>`;
    })
        .join('');
    if (inline) {
        return `<div style="margin-top:28px;padding-top:24px;border-top:1px solid #f1f5f9;">
      <div style="text-align:center;">
        <span style="display:inline-block;padding:5px 12px;border-radius:999px;background:#f3f4f6;color:#111;font-size:12px;font-weight:800;">${escHtml(data.statusLabel)}</span>
        <div style="margin:12px 0 6px;font-size:22px;font-weight:800;letter-spacing:0.08em;">${escHtml(data.trackingCode)}</div>
        ${data.orderNumber ? `<p style="margin:0;font-size:13px;color:#6b7280;">Pedido #${escHtml(data.orderNumber)}</p>` : ''}
        ${data.destinationCity ? `<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Destino: ${escHtml(data.destinationCity)}</p>` : ''}
      </div>
      <ul style="list-style:none;margin:20px 0 0;padding:0;">${events}</ul>
    </div>`;
    }
    return `<div class="lh-track-result">
    <div style="text-align:center;">
      <span class="lh-track-status">${escHtml(data.statusLabel)}</span>
      <div class="lh-track-code">${escHtml(data.trackingCode)}</div>
      ${data.orderNumber ? `<p class="lh-track-meta">Pedido #${escHtml(data.orderNumber)}</p>` : ''}
      ${data.destinationCity ? `<p class="lh-track-meta">Destino: ${escHtml(data.destinationCity)}</p>` : ''}
    </div>
    <ul class="lh-track-timeline">${events}</ul>
  </div>`;
}
/** Script del widget: consulta por API sin cambiar de página (multilupo.com.ar). */
function buildSeguimientoWidgetScript() {
    return `(function () {
  function init(root) {
    if (!root || root.getAttribute('data-lh-init') === '1') return;
    root.setAttribute('data-lh-init', '1');
    var apiBase = (root.getAttribute('data-api-base') || '').replace(/\\/$/, '');
    var form = root.querySelector('#lh-tracking-form');
    var input = root.querySelector('#lh-tracking-code');
    var btn = root.querySelector('#lh-tracking-submit');
    var errBox = root.querySelector('#lh-tracking-error');
    var errText = root.querySelector('#lh-tracking-error-text');
    var resultBox = root.querySelector('#lh-tracking-result');
    if (!form || !input || !btn || !errBox || !errText || !resultBox || !apiBase) return;

    function esc(s) {
      return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function formatDate(iso) {
      if (!iso) return '';
      try { return new Date(iso).toLocaleString('es-AR'); } catch (e) { return ''; }
    }
    function friendlyError(msg) {
      if (!msg) return 'No pudimos consultar el seguimiento. Intentá de nuevo en unos minutos.';
      if (msg === 'No encontramos ese código de seguimiento' || msg === 'Código de seguimiento inválido' || msg === 'Ingresá un código de seguimiento') return msg;
      return 'No pudimos consultar el seguimiento. Intentá de nuevo en unos minutos.';
    }
    function showError(msg) {
      errText.textContent = friendlyError(msg);
      errBox.style.display = 'flex';
      resultBox.innerHTML = '';
    }
    function hideError() {
      errBox.style.display = 'none';
      errText.textContent = '';
    }
    function renderResult(data) {
      hideError();
      var events = (data.events || []).map(function (ev) {
        return '<li style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:' + (ev.done ? '#111' : '#9ca3af') + ';">' +
          '<span style="width:10px;height:10px;border-radius:50%;margin-top:4px;background:' + (ev.done ? '#111' : '#d1d5db') + ';flex-shrink:0;"></span>' +
          '<span><strong>' + esc(ev.label) + '</strong>' + (ev.at ? '<br/><span style="color:#9ca3af;font-size:12px;">' + esc(formatDate(ev.at)) + '</span>' : '') + '</span></li>';
      }).join('');
      resultBox.innerHTML =
        '<div style="margin-top:28px;padding-top:24px;border-top:1px solid #f1f5f9;text-align:center;">' +
        '<span style="display:inline-block;padding:5px 12px;border-radius:999px;background:#f3f4f6;color:#111;font-size:12px;font-weight:800;">' + esc(data.statusLabel) + '</span>' +
        '<div style="margin:12px 0 6px;font-size:22px;font-weight:800;letter-spacing:0.08em;">' + esc(data.trackingCode) + '</div>' +
        (data.orderNumber ? '<p style="margin:0;font-size:13px;color:#6b7280;">Pedido #' + esc(data.orderNumber) + '</p>' : '') +
        (data.destinationCity ? '<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Destino: ' + esc(data.destinationCity) + '</p>' : '') +
        '<ul style="list-style:none;margin:20px 0 0;padding:0;text-align:left;">' + events + '</ul></div>';
    }
    function search() {
      var code = String(input.value || '').trim().toUpperCase();
      hideError();
      resultBox.innerHTML = '';
      if (!code) {
        showError('Ingresá un código de seguimiento');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Consultando…';
      fetch(apiBase + '/public/tracking/' + encodeURIComponent(code))
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.data && res.data.message ? res.data.message : 'Error');
          renderResult(res.data);
        })
        .catch(function (e) {
          showError(e.message || 'Error');
        })
        .finally(function () {
          btn.disabled = false;
          btn.textContent = 'Consultar';
        });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); search(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(); } });
    var q = new URLSearchParams(window.location.search).get('code');
    if (q) { input.value = q; search(); }
  }
  var nodes = document.querySelectorAll('#lh-tracking-root');
  for (var i = 0; i < nodes.length; i++) init(nodes[i]);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      var late = document.querySelectorAll('#lh-tracking-root');
      for (var j = 0; j < late.length; j++) init(late[j]);
    });
  }
})();`;
}
/** HTML embebido en Tienda Nube: consulta en el sitio, sin redirigir a otra URL. */
function buildTiendaNubeInlinePageContent(apiBaseUrl) {
    const apiBase = escHtml(apiBaseUrl.replace(/\/$/, ''));
    const cardStyle = 'max-width:560px;margin:0 auto;padding:24px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;';
    const innerCardStyle = 'background:#fff;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,0.08);padding:32px 28px 28px;';
    return `<div id="lh-tracking-root" data-api-base="${apiBase}" style="${cardStyle}">
  <div style="${innerCardStyle}">
    <p style="margin:0 0 28px;text-align:center;font-size:15px;line-height:1.55;color:#333;">
      Ingresá tu código de seguimiento para conocer el estado de tu envío express.
    </p>
    <form id="lh-tracking-form" style="margin:0;" action="javascript:void(0)">
      <label style="display:block;margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;text-align:center;">
        Código de seguimiento
      </label>
      <input
        id="lh-tracking-code"
        type="text"
        name="code"
        required
        placeholder="${PLACEHOLDER_CODE}"
        autocomplete="off"
        style="width:100%;padding:16px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:20px;font-weight:700;text-align:center;letter-spacing:0.06em;color:#111;background:#fff;box-sizing:border-box;"
      />
      <p style="margin:10px 0 0;text-align:center;font-size:12px;color:#9ca3af;line-height:1.4;">
        El código figura en el mail de confirmación de envío.
      </p>
      <button
        id="lh-tracking-submit"
        type="submit"
        style="margin-top:22px;width:100%;padding:16px;border:0;border-radius:8px;background:#111;color:#fff;font-size:13px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;cursor:pointer;"
      >
        Consultar
      </button>
    </form>
    <div id="lh-tracking-result"></div>
  </div>
  <div id="lh-tracking-error" style="display:none;align-items:flex-start;gap:10px;max-width:560px;margin:16px auto 0;padding:14px 16px;border:1px solid #f87171;border-radius:8px;background:#fef2f2;color:#dc2626;font-size:13px;line-height:1.45;">
    <span style="flex-shrink:0;width:18px;height:18px;border:1.5px solid #dc2626;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;">!</span>
    <span id="lh-tracking-error-text"></span>
  </div>
</div>
<script src="${apiBase}/public/seguimiento-widget.js" defer></script>`;
}
/** Página completa en el backend (formulario + resultado server-side, sin JS). */
function buildPublicTrackingFullPageHtml(opts) {
    const errorBlock = opts.error ? renderErrorBlock(opts.error, false) : '';
    const resultBlock = opts.data ? renderResultBlock(opts.data, false) : '';
    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Seguimiento de envío express</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f4f6; color: #111; }
    ${trackingFormStyles()}
  </style>
</head>
<body>
  <div class="lh-track-wrap">
    <div class="lh-track-card">
      ${renderTrackingFormFields({ action: opts.seguimientoUrl, code: opts.code, inline: false })}
      ${resultBlock}
    </div>
    ${errorBlock}
  </div>
</body>
</html>`;
}
