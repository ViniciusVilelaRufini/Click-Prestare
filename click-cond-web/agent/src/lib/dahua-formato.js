'use strict';

function formatDahuaTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function parseDahuaINI(text) {
  const lines = text.split(/\r?\n/);
  const records = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('=');
    if (parts.length < 2) continue;
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    const match = key.match(/^records\[(\d+)\]\.(.+)$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      const field = match[2];
      if (!records[idx]) {
        records[idx] = {};
      }
      records[idx][field] = value;
    }
  }
  return records.filter(Boolean);
}

/** CreateTime do aparelho (epoch unix, string) → ISO. Se o relógio estiver
 *  zerado (aparelho sem NTP volta a 2000 ao perder energia), usa agora. */
function dahuaEpochToISO(createTime) {
  const sec = parseInt(createTime, 10);
  if (!sec || sec < 1577836800 /* 2020-01-01 */) return new Date().toISOString();
  return new Date(sec * 1000).toISOString();
}

/**
 * ISO 8601 com offset explícito ("2026-08-17T11:30:00-03:00"), formato que o
 * ISAPI exige em startTime/endTime — firmwares recusam o sufixo "Z".
 */
function hikIsoComOffset(date) {
  const off = -date.getTimezoneOffset();
  const sinal = off >= 0 ? '+' : '-';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return (
    local.toISOString().slice(0, 19) + sinal + pad(off / 60) + ':' + pad(off % 60)
  );
}

module.exports = { formatDahuaTime, parseDahuaINI, dahuaEpochToISO, hikIsoComOffset };
